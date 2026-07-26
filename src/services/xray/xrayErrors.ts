export type XrayErrorCode =
  | "XRAY_VALIDATION_ERROR"
  | "XRAY_NOT_FOUND"
  | "XRAY_CONFLICT"
  | "XRAY_PERSISTENCE_ERROR"
  | "XRAY_ADAPTER_ERROR";

export class XrayServiceError extends Error {
  readonly code: XrayErrorCode;
  readonly status: number;

  constructor(message: string, code: XrayErrorCode, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "XrayServiceError";
    this.code = code;
    this.status = status;
  }
}

export class XrayValidationError extends XrayServiceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "XRAY_VALIDATION_ERROR", 400, options);
    this.name = "XrayValidationError";
  }
}

export class XrayNotFoundError extends XrayServiceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "XRAY_NOT_FOUND", 404, options);
    this.name = "XrayNotFoundError";
  }
}

export class XrayConflictError extends XrayServiceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "XRAY_CONFLICT", 409, options);
    this.name = "XrayConflictError";
  }
}

export class XrayPersistenceError extends XrayServiceError {
  constructor(message = "Unable to store X-ray scan data", options?: ErrorOptions) {
    super(message, "XRAY_PERSISTENCE_ERROR", 500, options);
    this.name = "XrayPersistenceError";
  }
}

export class XrayAdapterError extends XrayServiceError {
  constructor(message = "Unable to retrieve the X-ray scan", options?: ErrorOptions) {
    super(message, "XRAY_ADAPTER_ERROR", 502, options);
    this.name = "XrayAdapterError";
  }
}
