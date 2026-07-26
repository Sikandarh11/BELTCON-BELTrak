import { z } from "zod";

import type { HbssIngestionPayload, HbssScanResult } from "@/types/xray";
import { HbssPayloadValidationError } from "./hbssErrors";

export const bhsUidSchema = z
  .string()
  .trim()
  .min(1, "BHS UID is required")
  .max(128, "BHS UID is too long")
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    "BHS UID may only contain letters, numbers, dots, underscores, colons, and hyphens",
  );

export const xrayImageViewSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  url: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.toLowerCase().startsWith("data:"), {
      message: "Base64/data image URLs are not accepted",
    }),
  mimeType: z.string().trim().min(1),
});

export const hbssScanResultSchema = z
  .object({
    externalScanId: z.string().trim().min(1),
    bhsUid: bhsUidSchema,
    sourceSystem: z.string().trim().min(1),
    status: z.enum(["AVAILABLE", "PENDING", "FAILED", "NOT_FOUND"]),
    images: z.array(xrayImageViewSchema),
    threatLevel: z.number().int().min(1).max(5).optional(),
    threatType: z.string().trim().min(1).optional(),
    capturedAt: z.string().datetime({ offset: true }).optional(),
    metadata: z.record(z.unknown()).optional(),
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
