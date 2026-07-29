import "@tanstack/react-start/server-only";

import { z } from "zod";

import { canonicalRoleSchema, type CanonicalRole } from "@/auth/canonicalRoles";
import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import { permissionCodeSchema, type PermissionCode } from "@/services/admin/roles/roleSchemas";

const activeProfileSchema = z.object({
  id: z.string().uuid(),
  role: canonicalRoleSchema,
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "LOCKED", "DEACTIVATED"]),
  is_active: z.boolean(),
});

const authorizationRoleSchema = z.object({
  id: z.string().uuid(),
  name: canonicalRoleSchema,
  is_active: z.boolean(),
  version: z.number().int().min(1),
});

const grantRowsSchema = z.array(
  z.object({
    permission_id: z.string().uuid(),
    granted: z.boolean(),
  }),
);

const permissionRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    code: permissionCodeSchema,
  }),
);

export interface EffectiveAuthorization {
  userId: string;
  profileId: string;
  canonicalRole: CanonicalRole;
  permissions: PermissionCode[];
  accountStatus: "ACTIVE";
  authorizationVersion: number;
}

/** A safe, current actor resolved from the canonical BELTCON profile. */
export type AuthorizedActor = EffectiveAuthorization;

export class PermissionAuthorizationError extends Error {
  readonly code:
    | "ACCOUNT_PROFILE_MISSING"
    | "ACCOUNT_INACTIVE"
    | "ACCOUNT_SUSPENDED"
    | "ACCOUNT_LOCKED"
    | "ACCOUNT_DEACTIVATED"
    | "ACCOUNT_STATUS_INVALID"
    | "PERMISSION_CONFIGURATION_ERROR"
    | "PERMISSION_DENIED"
    | "PERMISSION_UNKNOWN";
  readonly status: number;

  constructor(
    message: string,
    code:
      | "ACCOUNT_PROFILE_MISSING"
      | "ACCOUNT_INACTIVE"
      | "ACCOUNT_SUSPENDED"
      | "ACCOUNT_LOCKED"
      | "ACCOUNT_DEACTIVATED"
      | "ACCOUNT_STATUS_INVALID"
      | "PERMISSION_CONFIGURATION_ERROR"
      | "PERMISSION_DENIED"
      | "PERMISSION_UNKNOWN",
    status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PermissionAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

function accountStateError(
  status:
    | "ACCOUNT_PROFILE_MISSING"
    | "ACCOUNT_INACTIVE"
    | "ACCOUNT_SUSPENDED"
    | "ACCOUNT_LOCKED"
    | "ACCOUNT_DEACTIVATED"
    | "ACCOUNT_STATUS_INVALID",
  cause?: unknown,
) {
  return new PermissionAuthorizationError(
    "The authenticated account is not eligible for BELTCON SBTS access",
    status,
    403,
    cause === undefined ? undefined : { cause },
  );
}

function configurationError(message: string, cause: unknown) {
  return new PermissionAuthorizationError(message, "PERMISSION_CONFIGURATION_ERROR", 500, {
    cause,
  });
}

export async function loadEffectiveAuthorization(userId: string): Promise<EffectiveAuthorization> {
  const client = getSupabaseAdminClient();
  const profileResult = await client
    .from("profiles")
    .select("id,role,status,is_active")
    .eq("id", userId)
    .maybeSingle();

  if (profileResult.error) {
    throw configurationError(
      "Unable to load the current authorization profile",
      profileResult.error,
    );
  }

  if (!profileResult.data) {
    throw accountStateError("ACCOUNT_PROFILE_MISSING");
  }

  const profile = activeProfileSchema.safeParse(profileResult.data);
  if (!profile.success) {
    throw accountStateError("ACCOUNT_STATUS_INVALID", profile.error);
  }

  if (!profile.data.is_active || profile.data.status === "PENDING") {
    throw accountStateError("ACCOUNT_INACTIVE");
  }
  if (profile.data.status === "SUSPENDED") {
    throw accountStateError("ACCOUNT_SUSPENDED");
  }
  if (profile.data.status === "LOCKED") {
    throw accountStateError("ACCOUNT_LOCKED");
  }
  if (profile.data.status === "DEACTIVATED") {
    throw accountStateError("ACCOUNT_DEACTIVATED");
  }
  if (profile.data.status !== "ACTIVE") {
    throw accountStateError("ACCOUNT_STATUS_INVALID");
  }

  const roleResult = await client
    .from("roles")
    .select("id,name,is_active,version")
    .eq("name", profile.data.role)
    .maybeSingle();

  if (roleResult.error) {
    throw configurationError("Unable to load the current canonical role", roleResult.error);
  }

  const role = authorizationRoleSchema.safeParse(roleResult.data);
  if (!role.success || !role.data.is_active || role.data.name !== profile.data.role) {
    throw accountStateError("ACCOUNT_STATUS_INVALID", role.success ? undefined : role.error);
  }

  const grantsResult = await client
    .from("role_permissions")
    .select("permission_id,granted")
    .eq("role_id", role.data.id)
    .eq("granted", true);
  if (grantsResult.error) {
    throw configurationError("Unable to load role permission grants", grantsResult.error);
  }

  const grants = grantRowsSchema.safeParse(grantsResult.data ?? []);
  if (!grants.success) {
    throw configurationError("Stored role permission grants are invalid", grants.error);
  }

  const permissionIds = grants.data.map((grant) => grant.permission_id);
  if (permissionIds.length === 0) {
    return {
      userId,
      profileId: profile.data.id,
      canonicalRole: profile.data.role,
      permissions: [],
      accountStatus: "ACTIVE",
      authorizationVersion: role.data.version,
    };
  }

  const permissionsResult = await client
    .from("permissions")
    .select("id,code")
    .in("id", permissionIds);
  if (permissionsResult.error) {
    throw configurationError("Unable to load effective permissions", permissionsResult.error);
  }

  const permissions = permissionRowsSchema.safeParse(permissionsResult.data ?? []);
  if (!permissions.success || permissions.data.length !== permissionIds.length) {
    throw configurationError(
      "Stored effective permission data is invalid",
      permissions.success ? "Missing permission rows" : permissions.error,
    );
  }

  return {
    userId,
    profileId: profile.data.id,
    canonicalRole: profile.data.role,
    permissions: permissions.data.map((permission) => permission.code),
    accountStatus: "ACTIVE",
    authorizationVersion: role.data.version,
  };
}

export async function requirePermission(
  session: { user: { id: string } } | null,
  permissionCode: string,
): Promise<EffectiveAuthorization> {
  const permission = permissionCodeSchema.safeParse(permissionCode);
  if (!permission.success) {
    throw new PermissionAuthorizationError("Unknown permission code", "PERMISSION_UNKNOWN", 400, {
      cause: permission.error,
    });
  }
  if (!session?.user.id) {
    throw new PermissionAuthorizationError(
      "An authenticated session is required",
      "PERMISSION_DENIED",
      401,
    );
  }

  const authorization = await loadEffectiveAuthorization(session.user.id);
  if (!authorization.permissions.includes(permission.data)) {
    throw new PermissionAuthorizationError(
      `Permission ${permission.data} is required`,
      "PERMISSION_DENIED",
      403,
    );
  }
  return authorization;
}

/**
 * Route-level helper for a small number of pages that can be entered through
 * one of several persisted permissions. Endpoint mutations should normally
 * keep using requirePermission with their exact atomic permission.
 */
export async function requireAnyPermission(
  session: { user: { id: string } } | null,
  permissionCodes: readonly string[],
): Promise<EffectiveAuthorization> {
  if (permissionCodes.length === 0) {
    throw new PermissionAuthorizationError("Unknown permission code", "PERMISSION_UNKNOWN", 400);
  }

  const required: PermissionCode[] = [];
  for (const permissionCode of permissionCodes) {
    const parsed = permissionCodeSchema.safeParse(permissionCode);
    if (!parsed.success) {
      throw new PermissionAuthorizationError("Unknown permission code", "PERMISSION_UNKNOWN", 400);
    }
    required.push(parsed.data);
  }
  if (!session?.user.id) {
    throw new PermissionAuthorizationError(
      "An authenticated session is required",
      "PERMISSION_DENIED",
      401,
    );
  }

  const authorization = await loadEffectiveAuthorization(session.user.id);
  if (!required.some((permission) => authorization.permissions.includes(permission))) {
    throw new PermissionAuthorizationError(
      "A required permission is missing",
      "PERMISSION_DENIED",
      403,
    );
  }
  return authorization;
}
