import "@tanstack/react-start/server-only";

import { z } from "zod";

import { CANONICAL_ROLES, canonicalRoleSchema } from "@/auth/canonicalRoles";
import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import { RolePermissionError } from "./roleErrors";
import {
  PERMISSION_CODES,
  permissionCodeSchema,
  rolePermissionUpdateResultSchema,
  type PermissionCode,
  type RolePermissionFailureAuditInput,
  type RolePermissionUpdateResult,
  type RolesWithPermissions,
  type UpdateRolePermissionsInput,
} from "./roleSchemas";

const roleRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1),
  name: canonicalRoleSchema,
  description: z.string(),
  is_system: z.boolean(),
  is_active: z.boolean(),
  version: z.number().int().min(1),
});

const permissionRowSchema = z.object({
  id: z.string().uuid(),
  code: permissionCodeSchema,
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  risk_level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});

const rolePermissionRowSchema = z.object({
  role_id: z.string().uuid(),
  permission_id: z.string().uuid(),
  granted: z.boolean(),
});

const roleRowsSchema = z.array(roleRowSchema);
const permissionRowsSchema = z.array(permissionRowSchema);
const rolePermissionRowsSchema = z.array(rolePermissionRowSchema);

export interface RoleRepository {
  getRolesWithPermissions(): Promise<RolesWithPermissions>;
  updateRolePermissions(input: UpdateRolePermissionsInput): Promise<RolePermissionUpdateResult>;
  recordUpdateFailure(input: RolePermissionFailureAuditInput): Promise<void>;
}

function persistenceError(message: string, cause: unknown) {
  return new RolePermissionError(message, "ROLE_PERMISSION_PERSISTENCE_ERROR", 500, { cause });
}

function parseStoredRows<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw persistenceError(`Stored ${label} data is invalid`, parsed.error);
  }
  return parsed.data;
}

function mapRpcError(error: { code?: string; message?: string }): RolePermissionError {
  if (error.code === "40001") {
    return new RolePermissionError(
      "This role was changed by another administrator. Refresh and try again.",
      "ROLE_PERMISSION_VERSION_CONFLICT",
      409,
      { cause: error },
    );
  }
  if (error.code === "P0002") {
    return new RolePermissionError("Role was not found", "ROLE_PERMISSION_NOT_FOUND", 404, {
      cause: error,
    });
  }
  if (error.code === "P0004") {
    return new RolePermissionError(
      "Inactive roles cannot be changed",
      "ROLE_PERMISSION_INACTIVE_ROLE",
      409,
      { cause: error },
    );
  }
  if (error.code === "P0003") {
    return new RolePermissionError(
      "System Administrator must retain role.view, role.manage, user.view, user.manage, and settings.manage.",
      "ROLE_PERMISSION_LOCKOUT_RISK",
      409,
      { cause: error },
    );
  }
  if (error.code === "42501") {
    return new RolePermissionError(
      "Canonical System Administrator role is required",
      "ROLE_PERMISSION_FORBIDDEN",
      403,
      { cause: error },
    );
  }
  if (error.code === "22023") {
    return new RolePermissionError(
      "One or more permission codes are not recognized",
      "ROLE_PERMISSION_UNKNOWN_PERMISSION",
      400,
      { cause: error },
    );
  }
  return persistenceError("Unable to update role permissions", error);
}

export const roleRepository: RoleRepository = {
  async getRolesWithPermissions() {
    const client = getSupabaseAdminClient();
    const [rolesResult, permissionsResult, grantsResult] = await Promise.all([
      client
        .from("roles")
        .select("id,code,name,description,is_system,is_active,version")
        .order("name", { ascending: true }),
      client
        .from("permissions")
        .select("id,code,name,description,category,risk_level")
        .order("code", { ascending: true }),
      client.from("role_permissions").select("role_id,permission_id,granted"),
    ]);

    if (rolesResult.error) {
      throw persistenceError("Unable to load canonical roles", rolesResult.error);
    }
    if (permissionsResult.error) {
      throw persistenceError("Unable to load the permission catalog", permissionsResult.error);
    }
    if (grantsResult.error) {
      throw persistenceError("Unable to load role permission grants", grantsResult.error);
    }

    const roleRows = parseStoredRows(roleRowsSchema, rolesResult.data ?? [], "role");
    const permissionRows = parseStoredRows(
      permissionRowsSchema,
      permissionsResult.data ?? [],
      "permission",
    );
    const grantRows = parseStoredRows(
      rolePermissionRowsSchema,
      grantsResult.data ?? [],
      "role-permission",
    );
    const permissionById = new Map(permissionRows.map((permission) => [permission.id, permission]));
    const grantedByRole = new Map<string, PermissionCode[]>();

    for (const grant of grantRows) {
      if (!grant.granted) continue;
      const permission = permissionById.get(grant.permission_id);
      if (!permission) {
        throw persistenceError(
          "A role-permission grant references an unknown permission",
          grant.permission_id,
        );
      }
      const existing = grantedByRole.get(grant.role_id) ?? [];
      existing.push(permission.code);
      grantedByRole.set(grant.role_id, existing);
    }

    const permissionOrder = new Map(PERMISSION_CODES.map((code, index) => [code, index]));
    const roleOrder = new Map(CANONICAL_ROLES.map((role, index) => [role, index]));

    return {
      roles: roleRows
        .map((role) => ({
          id: role.id,
          code: role.code,
          name: role.name,
          description: role.description,
          isSystem: role.is_system,
          isActive: role.is_active,
          version: role.version,
          permissionCodes: (grantedByRole.get(role.id) ?? []).sort(
            (left, right) =>
              (permissionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
              (permissionOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
          ),
        }))
        .sort(
          (left, right) =>
            (roleOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
            (roleOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER),
        ),
      permissions: permissionRows
        .map((permission) => ({
          id: permission.id,
          code: permission.code,
          name: permission.name,
          description: permission.description,
          category: permission.category,
          riskLevel: permission.risk_level,
        }))
        .sort(
          (left, right) =>
            (permissionOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
            (permissionOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER),
        ),
    };
  },

  async updateRolePermissions(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("update_role_permissions_v1", {
      p_role_id: input.roleId,
      p_permission_codes: input.permissionCodes,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
      p_actor_id: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
      p_updated_at: input.timestamp,
    });

    if (error) throw mapRpcError(error);

    const parsed = rolePermissionUpdateResultSchema.safeParse(data);
    if (!parsed.success) {
      throw persistenceError("Role permission update returned invalid data", parsed.error);
    }
    return parsed.data;
  },

  async recordUpdateFailure(input) {
    const { error } = await getSupabaseAdminClient()
      .from("audit_events")
      .insert({
        action: "ROLE_PERMISSION_UPDATE_FAILED",
        actor_type: "USER",
        actor_id: input.actorId,
        canonical_role: input.canonicalRole,
        source_system: "BELTRAK_ADMIN",
        outcome: "FAILED",
        error_code: input.errorCode,
        request_id: input.requestId,
        metadata: {
          roleId: input.roleId,
          beforePermissionCodes: input.beforePermissionCodes,
          afterPermissionCodes: input.afterPermissionCodes,
          reason: input.reason,
          expectedVersion: input.expectedVersion,
        },
        created_at: input.timestamp,
      });

    if (error) {
      throw persistenceError("Unable to record the failed role-permission update", error);
    }
  },
};
