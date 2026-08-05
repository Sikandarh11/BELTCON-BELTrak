import "@tanstack/react-start/server-only";

import { z } from "zod";

export const BASELINE_RFID_DETECTION_ZONES = ["TAGGING", "CUSTOMS_EXIT", "RECHECK"] as const;
export type BaselineRfidDetectionZone = (typeof BASELINE_RFID_DETECTION_ZONES)[number];

export const RfidDetectionOutcomeSchema = z.enum([
  "DETECTION_CREATED",
  "DETECTION_UPDATED",
  "OPTIONAL_ZONE_IGNORED",
]);

export const BaselineRfidDetectionResultSchema = z
  .object({
    outcome: RfidDetectionOutcomeSchema,
    detectionId: z.string().uuid(),
    rfidEventId: z.string().uuid(),
    readerId: z.string().min(1),
    zone: z.string().min(1),
    epc: z.string().regex(/^(?:[0-9A-F]{24}|[0-9A-F]{32})$/),
    firstDetectedAt: z.string().datetime({ offset: true }),
    lastDetectedAt: z.string().datetime({ offset: true }),
    rawEventCount: z.number().int().min(0),
    totalReadCount: z.number().int().min(0),
    strongestRssiDbm: z.number().finite().nullable(),
    simulated: z.boolean(),
    version: z.number().int().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type RfidDetectionResult = z.infer<typeof BaselineRfidDetectionResultSchema>;
export const RfidDetectionResultSchema = BaselineRfidDetectionResultSchema;
