import "@tanstack/react-start/server-only";

import { z } from "zod";

export const RFID_DETECTION_OUTCOMES = [
  "EPISODE_CREATED",
  "EPISODE_UPDATED",
  "LATE_EVENT_RECORDED",
] as const;

export const RfidDetectionOutcomeSchema = z.enum(
  RFID_DETECTION_OUTCOMES,
);

export const RfidDeduplicationPolicySchema = z
  .object({
    windowMs: z.number().int().min(100).max(60_000),
    lateArrivalToleranceMs: z
      .number()
      .int()
      .min(0)
      .max(300_000),
    includeAntennaInKey: z.boolean(),
  })
  .strict();

export const RfidReadPointSchema = z
  .object({
    id: z.string().uuid(),
    siteId: z.string().min(1).max(200),
    readerId: z.string().min(1).max(200),
    antennaPort: z.number().int().min(1).max(64).nullable(),
    code: z.string().min(1).max(120),
    name: z.string().min(1).max(160),
    zone: z.string().min(1).max(80),
    enabled: z.boolean(),
    dedupWindowMs: z.number().int().min(100).max(60_000),
    lateArrivalToleranceMs: z.number().int().min(0).max(300_000),
    includeAntennaInKey: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const RfidDetectionEpisodeSchema = z
  .object({
    id: z.string().uuid(),
    siteId: z.string().min(1).max(200),
    readPointId: z.string().uuid(),
    readerId: z.string().min(1).max(200),
    epc: z
      .string()
      .regex(/^(?:[0-9A-F]{24}|[0-9A-F]{32})$/),
    antennaPort: z.number().int().min(1).max(64).nullable(),
    firstDetectedAt: z.string().datetime({ offset: true }),
    lastDetectedAt: z.string().datetime({ offset: true }),
    rawEventCount: z.number().int().min(1),
    totalReadCount: z.number().int().min(1),
    strongestRssiDbm: z.number().finite().nullable(),
    weakestRssiDbm: z.number().finite().nullable(),
    latestRssiDbm: z.number().finite().nullable(),
    simulated: z.boolean(),
    version: z.number().int().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const RfidDetectionEventLinkSchema = z
  .object({
    detectionId: z.string().uuid(),
    rfidEventId: z.string(),
    linkedAt: z.string().datetime({ offset: true }),
    processingOutcome: RfidDetectionOutcomeSchema,
  })
  .strict();

export const RfidDetectionInputSchema = z
  .object({
    rfidEventId: z.string().uuid(),
    siteId: z.string().min(1).max(200),
    readerId: z.string().min(1).max(200),
    readPointId: z.string().min(1).max(200),
    epc: z
      .string()
      .regex(/^(?:[0-9A-F]{24}|[0-9A-F]{32})$/),
    antennaPort: z.number().int().min(1).max(64),
    rssiDbm: z.number().finite().nullable(),
    firstSeenAt: z.string().datetime({ offset: true }),
    lastSeenAt: z.string().datetime({ offset: true }),
    readCount: z.number().int().min(1),
    receivedAt: z.string().datetime({ offset: true }),
    simulated: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      Date.parse(value.lastSeenAt) <
      Date.parse(value.firstSeenAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastSeenAt"],
        message: "lastSeenAt cannot precede firstSeenAt",
      });
    }
  });

export const RfidDetectionResultSchema = z
  .object({
    outcome: RfidDetectionOutcomeSchema,
    detectionId: z.string().uuid(),
    readPointId: z.string().min(1),
    readPointCode: z.string().min(1),
    readPointName: z.string().min(1),
    readPointZone: z.string().min(1),
    readerId: z.string().min(1),
    epc: z.string(),
    antennaPort: z.number().int().min(1).max(64).nullable(),
    firstDetectedAt: z.string().datetime({ offset: true }),
    lastDetectedAt: z.string().datetime({ offset: true }),
    rawEventCount: z.number().int().min(1),
    totalReadCount: z.number().int().min(1),
    strongestRssiDbm: z.number().finite().nullable(),
    weakestRssiDbm: z.number().finite().nullable(),
    latestRssiDbm: z.number().finite().nullable(),
    simulated: z.boolean(),
  })
  .strict();

export type RfidDeduplicationPolicy = z.infer<
  typeof RfidDeduplicationPolicySchema
>;

export type RfidDetectionInput = z.infer<
  typeof RfidDetectionInputSchema
>;

export type RfidReadPoint = z.infer<typeof RfidReadPointSchema>;
export type RfidDetectionEpisode = z.infer<
  typeof RfidDetectionEpisodeSchema
>;
export type RfidDetectionEventLink = z.infer<
  typeof RfidDetectionEventLinkSchema
>;
export type RfidDetectionResult = z.infer<
  typeof RfidDetectionResultSchema
>;
