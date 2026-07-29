export type BhsMessageErrorCode =
  | "BHS_AUTHENTICATION_REQUIRED"
  | "BHS_AUTHENTICATION_FAILED"
  | "BHS_INVALID_MESSAGE"
  | "BHS_MESSAGE_TOO_LARGE"
  | "BHS_MESSAGE_CONFLICT"
  | "BHS_BAG_CONFLICT"
  | "BHS_PROCESSING_FAILED"
  | "BHS_INTEGRATION_UNAVAILABLE"
  | "BHS_CONTENT_TYPE_UNSUPPORTED";

export class BhsMessageError extends Error {
  constructor(
    message: string,
    readonly code: BhsMessageErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BhsMessageError";
  }
}

export class BhsMessagePersistenceError extends BhsMessageError {
  constructor(message = "BHS message processing failed", options?: ErrorOptions) {
    super(message, "BHS_PROCESSING_FAILED", 500, options);
    this.name = "BhsMessagePersistenceError";
  }
}
