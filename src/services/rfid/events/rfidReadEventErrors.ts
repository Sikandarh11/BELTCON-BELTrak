import "@tanstack/react-start/server-only";

export const RFID_READ_ERROR_CODES = [
  "RFID_READ_INVALID",
  "RFID_READER_NOT_FOUND",
  "RFID_READER_DISABLED",
  "RFID_READER_SITE_MISMATCH",
  "RFID_ADAPTER_TYPE_MISMATCH",
  "RFID_SOURCE_EVENT_CONFLICT",
  "RFID_READ_PERSISTENCE_FAILED",
  "RFID_READ_NOT_DURABLE",
  "RFID_READ_UNAUTHORIZED",
  "RFID_READ_POINT_NOT_FOUND",
  "RFID_READ_POINT_DISABLED",
  "RFID_ANTENNA_MAPPING_MISSING",
  "RFID_DEDUP_POLICY_INVALID",
  "RFID_DETECTION_EVENT_NOT_FOUND",
  "RFID_DETECTION_EVENT_TOO_OLD",
  "RFID_DETECTION_CONFLICT",
  "RFID_DETECTION_PERSISTENCE_FAILED",
  "RFID_DETECTION_PROCESSING_FAILED",
] as const;

export type RfidReadErrorCode =
  (typeof RFID_READ_ERROR_CODES)[number];

export class RfidReadError extends Error {
  readonly code: RfidReadErrorCode;
  readonly httpStatus: number;

  constructor(
    code: RfidReadErrorCode,
    message: string,
    httpStatus = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);

    this.name = "RfidReadError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isRfidReadError(
  value: unknown,
): value is RfidReadError {
  return value instanceof RfidReadError;
}
