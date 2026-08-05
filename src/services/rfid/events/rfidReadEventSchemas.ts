import "@tanstack/react-start/server-only";

import { z } from "zod";

import { RFID_ADAPTER_TYPES } from "../rfidReaderAdapter";

function containsAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

const exactIdentifierSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim(), {
    message: "Identifier must not contain surrounding whitespace",
  })
  .refine((value) => !containsAsciiControlCharacter(value), {
    message: "Identifier must not contain control characters",
  });

export const RfidSourceEventIdSchema = exactIdentifierSchema.brand(
  "RfidSourceEventId",
);

export const RfidReaderIdSchema = exactIdentifierSchema.brand(
  "RfidReaderId",
);

/**
 * EPC Gen2 identifiers supported by the current SBTS tagging workflow:
 *
 * 96-bit  = 24 hexadecimal characters
 * 128-bit = 32 hexadecimal characters
 *
 * Leading zeroes are preserved.
 */
export const CanonicalRfidEpcSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[0-9A-F]+$/.test(value), {
    message: "EPC must contain hexadecimal characters only",
  })
  .refine((value) => value.length === 24 || value.length === 32, {
    message: "EPC must be 96-bit or 128-bit hexadecimal",
  })
  .brand("CanonicalRfidEpc");

export const RfidAntennaPortSchema = z
  .number()
  .int()
  .min(1)
  .max(64);

export const RfidRssiDbmSchema = z
  .number()
  .finite()
  .min(-200)
  .max(100)
  .nullable();

export const RfidReadCountSchema = z
  .number()
  .int()
  .min(1)
  .max(1_000_000);

export const RfidReadTimestampSchema = z
  .string()
  .datetime({ offset: true });

export const TrustedRawRfidReadSchema = z
  .object({
    sourceEventId: RfidSourceEventIdSchema,
    readerId: RfidReaderIdSchema,
    epc: CanonicalRfidEpcSchema,
    antennaPort: RfidAntennaPortSchema,
    rssiDbm: RfidRssiDbmSchema,
    firstSeenAt: RfidReadTimestampSchema,
    lastSeenAt: RfidReadTimestampSchema,
    readCount: RfidReadCountSchema,
    adapterType: z.enum(RFID_ADAPTER_TYPES),
    simulated: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const firstSeenAt = Date.parse(value.firstSeenAt as string);
    const lastSeenAt = Date.parse(value.lastSeenAt as string);

    if (lastSeenAt < firstSeenAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastSeenAt"],
        message: "lastSeenAt must not be earlier than firstSeenAt",
      });
    }

    if (value.adapterType === "SIMULATED" && !value.simulated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulated"],
        message: "SIMULATED adapter events must be marked as simulated",
      });
    }

    if (value.adapterType !== "SIMULATED" && value.simulated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulated"],
        message:
          "Physical adapter events must not be marked as simulated",
      });
    }
  });

export const RfidReadIngestionOutcomeSchema = z.enum([
  "STORED",
  "DUPLICATE_REPLAY",
]);

export const RfidReadIngestionResultSchema = z
  .object({
    outcome: RfidReadIngestionOutcomeSchema,
    eventId: z.string().uuid(),
    sourceEventId: RfidSourceEventIdSchema,
    readerId: RfidReaderIdSchema,
    siteId: exactIdentifierSchema,
    epc: CanonicalRfidEpcSchema,
    receivedAt: RfidReadTimestampSchema,
    simulated: z.boolean(),
  })
  .strict();

export type TrustedRawRfidRead = z.infer<
  typeof TrustedRawRfidReadSchema
>;

export type RfidReadIngestionOutcome = z.infer<
  typeof RfidReadIngestionOutcomeSchema
>;

export type RfidReadIngestionResult = z.infer<
  typeof RfidReadIngestionResultSchema
>;
