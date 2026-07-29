export class ReaderApiError extends Error {
  readonly code:
    | "READER_NOT_FOUND"
    | "READER_UNAUTHORIZED"
    | "READER_VERSION_CONFLICT"
    | "READER_INVALID_CONFIGURATION"
    | "ANTENNA_NOT_FOUND"
    | "ANTENNA_INVALID_ZONE"
    | "ANTENNA_VERSION_CONFLICT"
    | "READER_QUERY_FAILED";
  readonly status: number;

  constructor(
    message: string,
    code: ReaderApiError["code"],
    status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReaderApiError";
    this.code = code;
    this.status = status;
  }
}
