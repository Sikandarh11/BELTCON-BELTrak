import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

import type { ScreeningSuspectEvent } from "@/types/screening";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError("The screening event contains a non-JSON value");
}

export function canonicalScreeningPayload(event: ScreeningSuspectEvent): string {
  return canonicalJson(event);
}

export function hashScreeningPayload(event: ScreeningSuspectEvent): string {
  return createHash("sha256").update(canonicalScreeningPayload(event), "utf8").digest("hex");
}
