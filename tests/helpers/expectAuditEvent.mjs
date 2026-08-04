import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

export function expectAuditEvent(events, expected) {
  const match = events.find((event) =>
    Object.entries(expected).every(([key, value]) => {
      if (key === "metadata" && value && typeof value === "object") {
        return Object.entries(value).every(([metadataKey, metadataValue]) =>
          isDeepStrictEqual(event.metadata?.[metadataKey], metadataValue),
        );
      }
      return Object.is(event[key], value);
    }),
  );
  assert.ok(match, `Expected audit event was not found: ${JSON.stringify(expected)}`);
  return match;
}
