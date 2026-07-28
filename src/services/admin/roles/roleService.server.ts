import "@tanstack/react-start/server-only";

import { roleIsAtLeast } from "@/auth/canonicalRoles";
import { RolePermissionError } from "./roleErrors";
import { roleRepository, type RoleRepository } from "./roleRepository.server";
import {
  CRITICAL_SYSTEM_ADMIN_PERMISSIONS,
  PERMISSION_CODES,
  type PermissionCode,
  type RolePermissionUpdateResult,
  type RolesWithPermissions,
  type UpdateRolePermissionsInput,
} from "./roleSchemas";

export interface RoleService {
  getRolesWithPermissions(canonicalRole: unknown): Promise<RolesWithPermissions>;
  updateRolePermissions(input: UpdateRolePermissionsInput): Promise<RolePermissionUpdateResult>;
}

const knownPermissionCodes = new Set<string>(PERMISSION_CODES);

function errorCode(error: unknown) {
  return error instanceof RolePermissionError ? error.code : "ROLE_PERMISSION_PERSISTENCE_ERROR";
}

function normalizedPermissionCodes(permissionCodes: string[]) {
  const order = new Map(PERMISSION_CODES.map((code, index) => [code, index]));
  return permissionCodes
    .map((code) => code.trim())
    .sort(
      (left, right) =>
        (order.get(left as PermissionCode) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right as PermissionCode) ?? Number.MAX_SAFE_INTEGER),
    );
}

export function createRoleService(repository: RoleRepository = roleRepository): RoleService {
  return {
    async getRolesWithPermissions(canonicalRole) {
      if (!roleIsAtLeast(canonicalRole, "Airport Administrator")) {
        throw new RolePermissionError(
          "Canonical Airport Administrator role or higher is required",
          "ROLE_PERMISSION_FORBIDDEN",
          403,
        );
      }
      return repository.getRolesWithPermissions();
    },

    async updateRolePermissions(input) {
      if (input.canonicalRole !== "System Administrator") {
        throw new RolePermissionError(
          "Canonical System Administrator role is required",
          "ROLE_PERMISSION_FORBIDDEN",
          403,
        );
      }

      let beforePermissionCodes: PermissionCode[] = [];
      const afterPermissionCodes = normalizedPermissionCodes(input.permissionCodes);

      try {
        const snapshot = await repository.getRolesWithPermissions();
        const role = snapshot.roles.find((candidate) => candidate.id === input.roleId);

        if (!role) {
          throw new RolePermissionError("Role was not found", "ROLE_PERMISSION_NOT_FOUND", 404);
        }
        beforePermissionCodes = role.permissionCodes;

        if (!role.isActive) {
          throw new RolePermissionError(
            "Inactive roles cannot be changed",
            "ROLE_PERMISSION_INACTIVE_ROLE",
            409,
          );
        }

        const unknownPermission = afterPermissionCodes.find(
          (code) => !knownPermissionCodes.has(code),
        );
        if (unknownPermission) {
          throw new RolePermissionError(
            `Unknown permission code: ${unknownPermission}`,
            "ROLE_PERMISSION_UNKNOWN_PERMISSION",
            400,
          );
        }

        if (role.version !== input.expectedVersion) {
          throw new RolePermissionError(
            "This role was changed by another administrator. Refresh and try again.",
            "ROLE_PERMISSION_VERSION_CONFLICT",
            409,
          );
        }

        if (
          role.name === "System Administrator" &&
          CRITICAL_SYSTEM_ADMIN_PERMISSIONS.some(
            (criticalPermission) => !afterPermissionCodes.includes(criticalPermission),
          )
        ) {
          throw new RolePermissionError(
            "System Administrator must retain role.view, role.manage, user.view, user.manage, and settings.manage.",
            "ROLE_PERMISSION_LOCKOUT_RISK",
            409,
          );
        }

        return await repository.updateRolePermissions({
          ...input,
          permissionCodes: afterPermissionCodes,
        });
      } catch (error) {
        try {
          await repository.recordUpdateFailure({
            actorId: input.actorId,
            canonicalRole: input.canonicalRole,
            roleId: input.roleId,
            beforePermissionCodes,
            afterPermissionCodes,
            reason: input.reason,
            expectedVersion: input.expectedVersion,
            requestId: input.requestId,
            timestamp: input.timestamp,
            errorCode: errorCode(error),
          });
        } catch (auditError) {
          throw new RolePermissionError(
            "Role permission update failed and the failure audit could not be recorded",
            "ROLE_PERMISSION_PERSISTENCE_ERROR",
            500,
            { cause: new AggregateError([error, auditError]) },
          );
        }

        if (error instanceof RolePermissionError) throw error;
        throw new RolePermissionError(
          "Unable to update role permissions",
          "ROLE_PERMISSION_PERSISTENCE_ERROR",
          500,
          { cause: error },
        );
      }
    },
  };
}

export const roleService = createRoleService();
