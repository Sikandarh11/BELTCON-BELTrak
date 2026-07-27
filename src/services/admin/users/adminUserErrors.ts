export type AdminUserErrorCode =
  | "ADMIN_USER_AUTH_CREATION_ERROR"
  | "ADMIN_USER_AUTH_USER_NOT_FOUND"
  | "ADMIN_USER_COMPENSATION_REQUIRED"
  | "ADMIN_USER_CONFIGURATION_ERROR"
  | "ADMIN_USER_DUPLICATE"
  | "ADMIN_USER_EMAIL_DELIVERY_FAILED"
  | "ADMIN_USER_FORBIDDEN"
  | "ADMIN_USER_INVALID_TRANSITION"
  | "ADMIN_USER_LAST_ADMIN_CONFLICT"
  | "ADMIN_USER_NOT_FOUND"
  | "ADMIN_USER_PERSISTENCE_ERROR"
  | "ADMIN_USER_UNAUTHORIZED"
  | "ADMIN_USER_VALIDATION_ERROR"
  | "ADMIN_USER_VERSION_CONFLICT";

export class AdminUserError extends Error {
  readonly code: AdminUserErrorCode;
  readonly status: number;

  constructor(message: string, code: AdminUserErrorCode, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "AdminUserError";
    this.code = code;
    this.status = status;
  }
}
