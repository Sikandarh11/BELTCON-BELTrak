export type AppApiErrorOptions = {
  code?: string;
  requestId?: string;
  fieldErrors?: Record<string, string>;
  currentVersion?: number;
  retryable?: boolean;
};

/** Browser-safe normalized error returned by BELTCON server APIs. */
export class AppApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly currentVersion?: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, options: AppApiErrorOptions = {}) {
    super(message);
    this.name = "AppApiError";
    this.status = status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.fieldErrors = options.fieldErrors;
    this.currentVersion = options.currentVersion;
    this.retryable = options.retryable ?? (status >= 500 || status === 429);
  }
}

type ErrorBody = Record<string, unknown>;

export async function readApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // HTTP status remains authoritative if an intermediary returned no JSON.
  }

  if (!response.ok) {
    throw new AppApiError(
      typeof body.error === "string" ? body.error : fallbackMessage,
      response.status,
      {
        code: typeof body.code === "string" ? body.code : undefined,
        requestId:
          typeof body.requestId === "string"
            ? body.requestId
            : (response.headers.get("x-request-id") ?? undefined),
        fieldErrors:
          body.fieldErrors && typeof body.fieldErrors === "object"
            ? (body.fieldErrors as Record<string, string>)
            : undefined,
        currentVersion: typeof body.currentVersion === "number" ? body.currentVersion : undefined,
      },
    );
  }

  return body as T;
}
