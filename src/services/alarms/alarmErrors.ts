export type AlarmErrorCode =
  | "ALARM_UNAUTHENTICATED"
  | "ALARM_UNAUTHORIZED"
  | "ALARM_NOT_FOUND"
  | "ALARM_INVALID_STATE"
  | "ALARM_VERSION_CONFLICT"
  | "ALARM_ALREADY_ACKNOWLEDGED"
  | "ALARM_ALREADY_ESCALATED"
  | "ALARM_ALREADY_AT_RECHECK"
  | "ALARM_BAG_NOT_FOUND"
  | "ALARM_BAG_STATE_CONFLICT"
  | "ALARM_REASON_REQUIRED"
  | "ALARM_VALIDATION_ERROR"
  | "ALARM_PROCESSING_FAILED";

export class AlarmServiceError extends Error {
  constructor(
    message: string,
    readonly code: AlarmErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AlarmServiceError";
  }
}
