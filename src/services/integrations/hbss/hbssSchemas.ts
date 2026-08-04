import { z } from "zod";

import { BhsUidSchema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import type { HbssIngestionPayload, HbssScanResult } from "@/types/xray";
import { HbssPayloadValidationError } from "./hbssErrors";

export const bhsUidSchema = BhsUidSchema;

const trustedSourceSystemSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const MAX_HBSS_METADATA_BYTES = 64 * 1024;
const dangerousObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

function containsDangerousObjectKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsDangerousObjectKey);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return true;
  }
  return Object.entries(value).some(
    ([key, nested]) => dangerousObjectKeys.has(key) || containsDangerousObjectKey(nested),
  );
}

function serializedByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isApprovedImagePath(value: string): boolean {
  return (
    /^\/mock-xray\/[A-Za-z0-9._/-]+$/.test(value) &&
    !value.split("/").some((segment) => segment === "..")
  );
}

const hbssMetadataSchema = z
  .unknown()
  .superRefine((metadata, context) => {
    if (containsDangerousObjectKey(metadata)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HBSS metadata contains an unsafe object key",
      });
    }
  })
  .pipe(z.record(z.unknown()))
  .superRefine((metadata, context) => {
    if (serializedByteLength(metadata) > MAX_HBSS_METADATA_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HBSS metadata exceeds the supported size",
      });
    }
  });

export const xrayImageViewSchema = z.strictObject({
  id: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(256),
  url: z.string().trim().min(1).max(1024).refine(isApprovedImagePath, {
    message: "Only approved local X-ray image paths are accepted",
  }),
  mimeType: z.enum(["image/jpeg", "image/png"]),
});

export const hbssScanResultSchema = z
  .strictObject({
    externalScanId: z.string().trim().min(1).max(128),
    bhsUid: bhsUidSchema,
    sourceSystem: trustedSourceSystemSchema,
    status: z.enum(["AVAILABLE", "PENDING", "FAILED", "NOT_FOUND", "ARCHIVED"]),
    images: z.array(xrayImageViewSchema).max(32),
    threatLevel: z.number().int().min(1).max(5).optional(),
    threatType: z.string().trim().min(1).max(256).optional(),
    capturedAt: z.string().datetime({ offset: true }).optional(),
    metadata: hbssMetadataSchema.optional(),
  })
  .superRefine((scan, context) => {
    if (scan.status === "AVAILABLE" && scan.images.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["images"],
        message: "AVAILABLE X-ray scans require at least one image",
      });
    }
  });

export const hbssIngestionPayloadSchema = hbssScanResultSchema;

export function parseBhsUid(value: unknown): string {
  const parsed = bhsUidSchema.safeParse(value);
  if (!parsed.success) {
    throw new HbssPayloadValidationError("Invalid BHS UID", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function parseHbssScanResult(value: unknown): HbssScanResult {
  const parsed = hbssScanResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new HbssPayloadValidationError("Invalid HBSS scan payload", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function parseHbssIngestionPayload(value: unknown): HbssIngestionPayload {
  const parsed = hbssIngestionPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new HbssPayloadValidationError("Invalid HBSS ingestion payload", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** The server credential owns sourceSystem; an inbound declaration may only confirm it. */
export function normalizeHbssIngestionPayload(
  value: unknown,
  trustedSourceSystemInput: string,
  trustedSiteIdInput?: string,
): HbssIngestionPayload {
  const trustedSourceSystem = trustedSourceSystemSchema.parse(trustedSourceSystemInput);
  const trustedSiteId =
    trustedSiteIdInput === undefined
      ? undefined
      : trustedSourceSystemSchema.parse(trustedSiteIdInput);
  const input = z.record(z.unknown()).parse(value);
  if (input.sourceSystem !== undefined && input.sourceSystem !== trustedSourceSystem) {
    throw new HbssPayloadValidationError(
      "HBSS sourceSystem does not match the authenticated integration",
    );
  }
  if (input.siteId !== undefined && input.siteId !== trustedSiteId) {
    throw new HbssPayloadValidationError(
      "HBSS siteId does not match the authenticated integration",
    );
  }
  const { siteId: _untrustedSiteId, ...payloadInput } = input;
  const parsed = parseHbssIngestionPayload({
    ...payloadInput,
    sourceSystem: trustedSourceSystem,
  });
  return {
    ...parsed,
    metadata: {
      ...(parsed.metadata ?? {}),
      ...(trustedSiteId ? { integrationSiteId: trustedSiteId } : {}),
    },
  };
}
