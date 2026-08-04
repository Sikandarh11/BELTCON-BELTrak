export type XrayErrorCode =
  | "XRAY_VALIDATION_ERROR"
  | "XRAY_NOT_FOUND"
  | "XRAY_CONFLICT"
  | "XRAY_PERSISTENCE_ERROR"
  | "XRAY_ADAPTER_ERROR"
  | "BHS_UID_REQUIRED"
  | "HBSS_BHS_UID_MISMATCH"
  | "HBSS_REQUEST_TIMED_OUT"
  | "XRAY_REQUEST_CANCELLED";

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

export class BhsUidRequiredError extends XrayServiceError {
  constructor(options?: ErrorOptions) {
    super("Bag has no valid BHS UID", "BHS_UID_REQUIRED", 409, options);
    this.name = "BhsUidRequiredError";
  }
}

export class HbssBhsUidMismatchError extends XrayServiceError {
  constructor(options?: ErrorOptions) {
    super("HBSS returned a scan for a different BHS BagID", "HBSS_BHS_UID_MISMATCH", 502, options);
    this.name = "HbssBhsUidMismatchError";
  }
}

export class HbssRequestTimedOutError extends XrayServiceError {
  constructor(options?: ErrorOptions) {
    super("HBSS scan retrieval timed out", "HBSS_REQUEST_TIMED_OUT", 504, options);
    this.name = "HbssRequestTimedOutError";
  }
}

export class XrayRequestCancelledError extends XrayServiceError {
  constructor(options?: ErrorOptions) {
    super("HBSS scan retrieval was cancelled", "XRAY_REQUEST_CANCELLED", 499, options);
    this.name = "XrayRequestCancelledError";
  }
}
