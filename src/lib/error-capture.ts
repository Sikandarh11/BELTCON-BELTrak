// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

export type CapturedClientError = {
  id: string;
  message: string;
  stack: string | null;
  at: string;
};

let lastCapturedError: { error: unknown; at: number } | undefined;
let capturedErrors: CapturedClientError[] = [];
const listeners = new Set<() => void>();
const TTL_MS = 5_000;

function record(error: unknown) {
  const now = Date.now();
  const normalizedError = error instanceof Error ? error : new Error(String(error));

  lastCapturedError = { error, at: now };
  capturedErrors = [
    {
      id: `client-error-${now}-${capturedErrors.length}`,
      message: normalizedError.message,
      stack: normalizedError.stack ?? null,
      at: new Date(now).toISOString(),
    },
    ...capturedErrors,
  ].slice(0, 50);
  listeners.forEach((listener) => listener());
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

export function getCapturedErrors(): readonly CapturedClientError[] {
  return capturedErrors;
}

export function subscribeToCapturedErrors(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearCapturedErrors() {
  capturedErrors = [];
  listeners.forEach((listener) => listener());
}
