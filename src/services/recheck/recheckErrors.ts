export type RecheckErrorCode =
  | "RECHECK_TAG_REQUIRED"
  | "RECHECK_CASE_NOT_FOUND"
  | "RECHECK_CASE_NOT_ELIGIBLE"
  | "RECHECK_TAG_CONFLICT"
  | "RECHECK_UNAUTHENTICATED"
  | "RECHECK_UNAUTHORIZED"
  | "RECHECK_BAG_NOT_FOUND"
  | "RECHECK_ALARM_NOT_FOUND"
  | "RECHECK_ALARM_MISMATCH"
  | "RECHECK_INVALID_BAG_STATE"
  | "RECHECK_INVALID_ALARM_STATE"
  | "RECHECK_VERSION_CONFLICT"
  | "RECHECK_RESOLUTION_CONFLICT"
  | "RECHECK_VALIDATION_ERROR"
  | "RECHECK_PROCESSING_FAILED"
  | "HBSS_BHS_UID_REQUIRED"
  | "HBSS_ADAPTER_NOT_CONFIGURED"
  | "HBSS_RECALL_FAILED"
  | "HBSS_RECALL_UNAVAILABLE";
export class RecheckServiceError extends Error {
  constructor(
    message: string,
    readonly code: RecheckErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RecheckServiceError";
  }
}
