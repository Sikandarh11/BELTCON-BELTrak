export type TaggingErrorCode =
  | "TAGGING_VALIDATION_ERROR"
  | "TAGGING_UNAUTHORIZED"
  | "TAGGING_FORBIDDEN"
  | "TAGGING_BAG_NOT_FOUND"
  | "TAGGING_ALREADY_ENCODED"
  | "TAGGING_DUPLICATE_EPC"
  | "TAGGING_PERSISTENCE_ERROR"
  | "TAGGING_INTERNAL_ERROR"
  | "TAG_ASSIGNMENT_BAG_INELIGIBLE"
  | "TAG_ASSIGNMENT_BHS_UID_REQUIRED"
  | "TAG_ASSIGNMENT_EPC_CONFLICT"
  | "TAG_ASSIGNMENT_BARCODE_CONFLICT"
  | "TAG_ASSIGNMENT_VERSION_CONFLICT"
  | "TAG_ASSIGNMENT_INVALID_LPC";

export class TaggingServiceError extends Error {
  readonly code: TaggingErrorCode;
  readonly status: number;

  constructor(message: string, code: TaggingErrorCode, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaggingServiceError";
    this.code = code;
    this.status = status;
  }
}

export class TaggingValidationError extends TaggingServiceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "TAGGING_VALIDATION_ERROR", 400, options);
    this.name = "TaggingValidationError";
  }
}

export class TaggingBagNotFoundError extends TaggingServiceError {
  constructor(message = "Bag was not found", options?: ErrorOptions) {
    super(message, "TAGGING_BAG_NOT_FOUND", 404, options);
    this.name = "TaggingBagNotFoundError";
  }
}

export class TaggingAlreadyEncodedError extends TaggingServiceError {
  constructor(message = "Bag is no longer pending RFID encoding", options?: ErrorOptions) {
    super(message, "TAGGING_ALREADY_ENCODED", 409, options);
    this.name = "TaggingAlreadyEncodedError";
  }
}

export class TaggingDuplicateEpcError extends TaggingServiceError {
  constructor(message = "EPC is already assigned to another bag", options?: ErrorOptions) {
    super(message, "TAGGING_DUPLICATE_EPC", 409, options);
    this.name = "TaggingDuplicateEpcError";
  }
}

export class TaggingPersistenceError extends TaggingServiceError {
  constructor(message = "Unable to complete RFID encoding", options?: ErrorOptions) {
    super(message, "TAGGING_PERSISTENCE_ERROR", 500, options);
    this.name = "TaggingPersistenceError";
  }
}

export class TagAssignmentConflictError extends TaggingServiceError {
  constructor(
    message: string,
    code:
      | "TAG_ASSIGNMENT_BAG_INELIGIBLE"
      | "TAG_ASSIGNMENT_BHS_UID_REQUIRED"
      | "TAG_ASSIGNMENT_EPC_CONFLICT"
      | "TAG_ASSIGNMENT_BARCODE_CONFLICT"
      | "TAG_ASSIGNMENT_VERSION_CONFLICT",
  ) {
    super(message, code, 409);
    this.name = "TagAssignmentConflictError";
  }
}
