export class HbssError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HbssError";
    this.code = code;
  }
}

export class HbssConfigurationError extends HbssError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "HBSS_CONFIGURATION_ERROR", options);
    this.name = "HbssConfigurationError";
  }
}

export class HbssPayloadValidationError extends HbssError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "HBSS_PAYLOAD_VALIDATION_ERROR", options);
    this.name = "HbssPayloadValidationError";
  }
}
