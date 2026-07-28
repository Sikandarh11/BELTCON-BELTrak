import type {
  RolePermissionUpdateResult,
  RolesWithPermissions,
  UpdateRolePermissionsRequest,
} from "./roleSchemas";

export const ADMIN_ROLE_PERMISSIONS_QUERY_KEY = ["admin", "roles", "permissions"] as const;

export class RolePermissionApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "RolePermissionApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    return new RolePermissionApiError(
      body.error ?? "Role permission request failed",
      body.code ?? "ROLE_PERMISSION_REQUEST_FAILED",
      response.status,
    );
  } catch {
    return new RolePermissionApiError(
      "Role permission request failed",
      "ROLE_PERMISSION_REQUEST_FAILED",
      response.status,
    );
  }
}

export async function getRolesWithPermissions(): Promise<RolesWithPermissions> {
  const response = await fetch("/api/admin/roles/permissions", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as RolesWithPermissions;
}

export async function updateRolePermissions(
  roleId: string,
  input: UpdateRolePermissionsRequest,
): Promise<RolePermissionUpdateResult> {
  const response = await fetch(`/api/admin/roles/${encodeURIComponent(roleId)}/permissions`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { update: RolePermissionUpdateResult };
  return body.update;
}
