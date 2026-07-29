import type {
  RolePermissionUpdateResult,
  RolesWithPermissions,
  UpdateRolePermissionsRequest,
} from "./roleSchemas";
import { roleKeys } from "@/lib/queryKeys";
import { AppApiError, readApiResponse } from "@/services/api/appApiError";

export const ADMIN_ROLE_PERMISSIONS_QUERY_KEY = roleKeys.permissions();

export class RolePermissionApiError extends AppApiError {
  readonly code: string;

  constructor(message: string, code: string, status: number) {
    super(message, status, { code });
    this.name = "RolePermissionApiError";
    this.code = code;
  }
}

async function parseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string; code?: string; requestId?: string };
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
  return readApiResponse<RolesWithPermissions>(response, "Role permission request failed");
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
  const body = await readApiResponse<{ update: RolePermissionUpdateResult }>(
    response,
    "Role permission request failed",
  );
  return body.update;
}
