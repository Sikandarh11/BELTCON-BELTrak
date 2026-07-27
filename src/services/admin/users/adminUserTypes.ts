import type { CanonicalRole } from "@/auth/canonicalRoles";

export const ADMIN_USER_SYNC_STATUSES = [
  "COMPLETE",
  "MISSING_PROFILE",
  "MISSING_AUTH_USER",
  "EMAIL_MISMATCH",
] as const;

export type AdminUserSyncStatus = (typeof ADMIN_USER_SYNC_STATUSES)[number];
export type { CanonicalRole } from "@/auth/canonicalRoles";

export const ADMIN_USER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "LOCKED",
  "DEACTIVATED",
] as const;

export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

export interface AdminAuthIdentity {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
}

export interface AdminProfileIdentity {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: AdminUserStatus;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLogin: string | null;
  updatedAt: string;
  createdBy: string | null;
  version: number;
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string | null;
  status: AdminUserStatus | null;
  isActive: boolean | null;
  mustChangePassword: boolean | null;
  createdAt: string;
  lastLogin: string | null;
  emailConfirmed: boolean | null;
  syncStatus: AdminUserSyncStatus;
  version: number | null;
}

export interface AdminUserListFilters {
  search?: string;
  role?: CanonicalRole;
  status?: AdminUserStatus;
  isActive?: boolean;
  syncStatus?: AdminUserSyncStatus;
  page: number;
  pageSize: number;
}

export interface AdminUserPage {
  users: AdminUser[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface RepairAdminProfileInput {
  userId: string;
  firstName: string;
  lastName: string;
  role: CanonicalRole;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  reason: string;
  timestamp: string;
}

export interface RepairAdminProfileRequest {
  firstName: string;
  lastName: string;
  role: CanonicalRole;
  reason: string;
}

export interface CreateAdminUserRequest {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
  confirmPassword: string;
  role: CanonicalRole;
  isActive: boolean;
}

export interface CreatedAdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: CanonicalRole;
  status: "ACTIVE" | "PENDING";
  mustChangePassword: true;
}

export interface InviteAdminUserRequest {
  firstName: string;
  lastName: string;
  email: string;
  role: CanonicalRole;
}

export interface InviteAdminUserInput extends InviteAdminUserRequest {
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
  redirectTo: string;
}

export interface InvitedAdminUser extends CreatedAdminUser {
  status: "PENDING";
  deliveryStatus: "SENT" | "FAILED";
}

export interface EditAdminUserRequest {
  firstName: string;
  lastName: string;
  role: CanonicalRole;
  isActive: boolean;
  expectedVersion: number;
  reason: string;
}

export interface EditAdminUserInput extends EditAdminUserRequest {
  userId: string;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
}

export const ADMIN_USER_ACTIONS = [
  "ACTIVATE",
  "SUSPEND",
  "LOCK",
  "UNLOCK",
  "DEACTIVATE",
  "SEND_PASSWORD_RESET",
  "RESEND_INVITATION",
] as const;

export type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];

export interface AdminUserActionRequest {
  action: AdminUserAction;
  expectedVersion: number;
  reason: string;
}

export interface AdminUserActionInput extends AdminUserActionRequest {
  userId: string;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
  redirectTo: string;
}

export interface AdminUserActionResult {
  user: AdminUser;
  action: AdminUserAction;
  deliveryStatus?: "SENT" | "FAILED";
}

export interface InviteAdminAuthUserInput {
  email: string;
  firstName: string;
  lastName: string;
  redirectTo: string;
}

export interface CreateInvitedProfileInput {
  userId: string;
  firstName: string;
  lastName: string;
  role: CanonicalRole;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
  deliveryStatus: "SENT" | "FAILED";
}

export interface CreateAdminUserInput extends CreateAdminUserRequest {
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
}

export interface CreateAdminAuthUserInput {
  email: string;
  temporaryPassword: string;
  firstName: string;
  lastName: string;
}

export interface CreateAdminProfileInput {
  userId: string;
  firstName: string;
  lastName: string;
  role: CanonicalRole;
  isActive: boolean;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
}

export type AdminUserAuditAction =
  | "USER_CREATION_REQUESTED"
  | "AUTH_USER_CREATED"
  | "USER_CREATION_FAILED"
  | "USER_CREATION_COMPENSATION_REQUIRED"
  | "USER_INVITED"
  | "USER_INVITATION_RESENT"
  | "PASSWORD_RESET_SENT";

export interface AdminUserAuditInput {
  action: AdminUserAuditAction;
  actorId: string;
  canonicalRole: CanonicalRole;
  targetUserId: string | null;
  targetEmail: string;
  assignedRole: CanonicalRole;
  outcome: "REQUESTED" | "SUCCESS" | "FAILURE" | "COMPENSATED" | "CRITICAL" | "DELIVERY_FAILED";
  requestId: string;
  timestamp: string;
  errorCode?: string;
  compensation?: "AUTH_USER_DELETED" | "AUTH_USER_DELETE_FAILED";
  reason?: string;
  deliveryStatus?: "SENT" | "FAILED";
}
