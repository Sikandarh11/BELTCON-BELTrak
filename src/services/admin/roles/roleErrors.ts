export type RolePermissionErrorCode =
  | "ROLE_PERMISSION_FORBIDDEN"
  | "ROLE_PERMISSION_INACTIVE_ROLE"
  | "ROLE_PERMISSION_LOCKOUT_RISK"
  | "ROLE_PERMISSION_NOT_FOUND"
  | "ROLE_PERMISSION_PERSISTENCE_ERROR"
  | "ROLE_PERMISSION_UNAUTHORIZED"
  | "ROLE_PERMISSION_UNKNOWN_PERMISSION"
  | "ROLE_PERMISSION_VALIDATION_ERROR"
  | "ROLE_PERMISSION_VERSION_CONFLICT";

export class RolePermissionError extends Error {
  readonly code: RolePermissionErrorCode;
  readonly status: number;

  constructor(
    message: string,
    code: RolePermissionErrorCode,
    status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RolePermissionError";
    this.code = code;
    this.status = status;
  }
}
