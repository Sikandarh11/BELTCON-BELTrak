import { z } from "zod";

import {
  BhsUidSchema,
  RawScreeningEvaluationSchema,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";

const localDemoImageRefSchema = z
  .string()
  .trim()
  .startsWith("/mock-xray/", "Image references must be local /mock-xray/ paths")
  .refine((value) => !value.includes("..") && !value.includes("\\"), {
    message: "Image references may not contain path traversal",
  });

export const screeningImageV1Schema = z.object({
  imageId: z.string().trim().min(1),
  view: z.string().trim().min(1),
  label: z.string().trim().min(1),
  imageRef: localDemoImageRefSchema,
  mimeType: z.enum(["image/jpeg", "image/png"]),
});

export const screeningScanV1Schema = z
  .object({
    externalScanId: z.string().trim().min(1),
    status: z.enum(["AVAILABLE", "PENDING", "FAILED", "NOT_FOUND"]),
    images: z.array(screeningImageV1Schema),
  })
  .superRefine((scan, context) => {
    if (scan.status === "AVAILABLE" && scan.images.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["images"],
        message: "AVAILABLE screening scans require at least one image",
      });
    }
  });

export const screeningEventV1Schema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("BAG_SUSPECTED"),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime({ offset: true }),
  sourceSystem: z.string().trim().min(1),
  bag: z.object({
    bhsUid: BhsUidSchema,
    iataCode: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "IATA code must contain 10 digits")
      .optional(),
    iataOrigin: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "IATA origin must be a three-letter uppercase code")
      .optional(),
    flightNo: z.string().trim().min(1).max(32),
    passengerName: z.string().trim().min(1).max(256).optional(),
  }),
  screening: z.object({
    station: z.string().trim().min(1),
    screenedAt: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(2_000).optional(),
    // Compatibility integrations may omit the decision. The authoritative
    // ingestion transaction derives REJECT for a suspect event in that case.
    evaluationRaw: RawScreeningEvaluationSchema.optional(),
  }),
  threat: z.object({
    type: z.string().trim().min(1),
    level: z.number().int().min(1).max(5),
  }),
  scan: screeningScanV1Schema,
});

export const SCREENING_CONFLICT_BAG_STATUSES = [
  "TAGGED",
  "ALARMED",
  "AT_RECHECK",
  "RESOLVED",
] as const;

export const SIMULATOR_SUBMIT_CANONICAL_ROLE = "System Administrator" as const;
export const XRAY_MINIMUM_CANONICAL_ROLE = "Operations Officer" as const;

export type ScreeningImageV1 = z.infer<typeof screeningImageV1Schema>;
export type ScreeningScanV1 = z.infer<typeof screeningScanV1Schema>;
export type ScreeningSuspectEvent = z.infer<typeof screeningEventV1Schema>;
export type ScreeningEventV1 = ScreeningSuspectEvent;

export function parseScreeningEventV1(value: unknown): ScreeningSuspectEvent {
  return screeningEventV1Schema.parse(value);
}
