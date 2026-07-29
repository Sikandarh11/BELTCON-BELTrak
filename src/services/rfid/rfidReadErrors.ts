export class RfidReadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RfidReadError";
  }
}
