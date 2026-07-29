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
import { userKeys } from "@/lib/queryKeys";
import { AppApiError, readApiResponse } from "@/services/api/appApiError";

export const ADMIN_USERS_QUERY_KEY = userKeys.all;

export class AdminUserApiError extends AppApiError {
  readonly code: string;

  constructor(message: string, code: string, status: number) {
    super(message, status, { code });
    this.name = "AdminUserApiError";
    this.code = code;
  }
}

export function adminUsersQueryKey(filters: AdminUserListFilters) {
  return userKeys.list(filters);
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
  return readApiResponse<AdminUserPage>(response, "User administration request failed");
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
  const body = await readApiResponse<{ user: AdminUser }>(
    response,
    "User administration request failed",
  );
  return body.user;
}

export async function createAdminUser(input: CreateAdminUserRequest): Promise<CreatedAdminUser> {
  const response = await fetch("/api/admin/users", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readApiResponse<{ user: CreatedAdminUser }>(
    response,
    "User administration request failed",
  );
  return body.user;
}

export async function inviteAdminUser(input: InviteAdminUserRequest): Promise<InvitedAdminUser> {
  const response = await fetch("/api/admin/users/invitations", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readApiResponse<{ invitation: InvitedAdminUser }>(
    response,
    "User administration request failed",
  );
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
  const body = await readApiResponse<{ user: AdminUser }>(
    response,
    "User administration request failed",
  );
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
  return readApiResponse<AdminUserActionResult>(response, "User administration request failed");
}
