export type ScreeningErrorCode =
  | "SCREENING_VALIDATION_ERROR"
  | "SCREENING_UNAUTHORIZED"
  | "SCREENING_NOT_CONFIGURED"
  | "SCREENING_PAYLOAD_TOO_LARGE"
  | "SCREENING_CONTENT_TYPE_UNSUPPORTED"
  | "SCREENING_CONFLICT"
  | "SCREENING_PERSISTENCE_ERROR"
  | "SCREENING_INTERNAL_ERROR";

export class ScreeningServiceError extends Error {
  readonly code: ScreeningErrorCode;
  readonly status: number;

  constructor(message: string, code: ScreeningErrorCode, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "ScreeningServiceError";
    this.code = code;
    this.status = status;
  }
}

export class ScreeningValidationError extends ScreeningServiceError {
  constructor(message = "Invalid screening suspect event", options?: ErrorOptions) {
    super(message, "SCREENING_VALIDATION_ERROR", 400, options);
    this.name = "ScreeningValidationError";
  }
}

export class ScreeningConflictError extends ScreeningServiceError {
  readonly conflictCode: string;

  constructor(message: string, conflictCode: string, options?: ErrorOptions) {
    super(message, "SCREENING_CONFLICT", 409, options);
    this.name = "ScreeningConflictError";
    this.conflictCode = conflictCode;
  }
}

export class ScreeningPersistenceError extends ScreeningServiceError {
  constructor(message = "Unable to store the screening event", options?: ErrorOptions) {
    super(message, "SCREENING_PERSISTENCE_ERROR", 500, options);
    this.name = "ScreeningPersistenceError";
  }
}
