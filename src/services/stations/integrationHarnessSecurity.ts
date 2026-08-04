const secretKeyPattern = /(secret|password|credential|api[-_]?key|integration[-_]?key|token)/i;

export function isSoftwareSimulatorEnabled(
  environment: "development" | "test" | "production",
  explicitlyEnabled: boolean,
) {
  return environment !== "production" && explicitlyEnabled;
}

export function sanitizeIntegrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Integration failure");
  return message
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[REDACTED_ENDPOINT]")
    .replace(/(key|secret|token|password|credential)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 256);
}

export function sanitizeScenarioExport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeScenarioExport);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = secretKeyPattern.test(key) ? "[REDACTED]" : sanitizeScenarioExport(child);
  }
  return result;
}

export function assertStationBinding(
  trusted: { stationId: string; siteId: string },
  presented: { stationId: string; siteId: string },
) {
  if (trusted.stationId !== presented.stationId || trusted.siteId !== presented.siteId) {
    throw new Error("STATION_BINDING_MISMATCH");
  }
}
