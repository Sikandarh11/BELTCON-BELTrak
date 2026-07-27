import type {
  AdminUser,
  AdminUserActionRequest,
  AdminUserActionResult,
  AdminUserListFilters,
  AdminUserPage,
  CreateAdminUserRequest,
  CreatedAdminUser,
  EditAdminUserRequest,
  InviteAdminUserRequest,
  InvitedAdminUser,
  RepairAdminProfileRequest,
} from "./adminUserTypes";

export const ADMIN_USERS_QUERY_KEY = ["admin", "users"] as const;

export class AdminUserApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "AdminUserApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    return new AdminUserApiError(
      body.error ?? "User administration request failed",
      body.code ?? "ADMIN_USER_REQUEST_FAILED",
      response.status,
    );
  } catch {
    return new AdminUserApiError(
      "User administration request failed",
      "ADMIN_USER_REQUEST_FAILED",
      response.status,
    );
  }
}

export function adminUsersQueryKey(filters: AdminUserListFilters) {
  return [...ADMIN_USERS_QUERY_KEY, filters] as const;
}

export async function listAdminUsers(filters: AdminUserListFilters): Promise<AdminUserPage> {
  const search = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.search) search.set("search", filters.search);
  if (filters.role) search.set("role", filters.role);
  if (filters.status) search.set("status", filters.status);
  if (filters.isActive !== undefined) search.set("active", String(filters.isActive));
  if (filters.syncStatus) search.set("syncStatus", filters.syncStatus);

  const response = await fetch(`/api/admin/users?${search}`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as AdminUserPage;
}

export async function repairAdminUserProfile(
  userId: string,
  input: RepairAdminProfileRequest,
): Promise<AdminUser> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/repair-profile`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { user: AdminUser };
  return body.user;
}

export async function createAdminUser(input: CreateAdminUserRequest): Promise<CreatedAdminUser> {
  const response = await fetch("/api/admin/users", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { user: CreatedAdminUser };
  return body.user;
}

export async function inviteAdminUser(input: InviteAdminUserRequest): Promise<InvitedAdminUser> {
  const response = await fetch("/api/admin/users/invitations", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { invitation: InvitedAdminUser };
  return body.invitation;
}

export async function editAdminUser(
  userId: string,
  input: EditAdminUserRequest,
): Promise<AdminUser> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { user: AdminUser };
  return body.user;
}

export async function performAdminUserAction(
  userId: string,
  input: AdminUserActionRequest,
): Promise<AdminUserActionResult> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/actions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as AdminUserActionResult;
}
