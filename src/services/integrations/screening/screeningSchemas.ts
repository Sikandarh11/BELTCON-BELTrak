import { z } from "zod";

import {
  screeningEventV1Schema,
  screeningImageV1Schema,
  type ScreeningSuspectEvent,
} from "@/types/screening";
import {
  BhsUidSchema,
  RawScreeningEvaluationSchema,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";

const inboundObjectSchema = z.record(z.unknown());
const trustedSourceSystemSchema = z
  .string()
  .trim()
  .min(1, "A configured screening source system is required")
  .max(128, "The screening source system is too long")
  .regex(/^[A-Za-z0-9._:-]+$/, "The screening source system contains unsupported characters");

export const screeningSimulatorInputSchema = z
  .object({
    eventId: z.string().uuid("Event ID must be a UUID"),
    // A simulator event represents the same external identity used by BHS
    // message 2001. Preserve its ten characters exactly, including zeros.
    bhsUid: BhsUidSchema,
    iataCode: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "IATA bag code must contain 10 digits"),
    iataOrigin: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "IATA origin must be a three-letter uppercase code"),
    flightNo: z.string().trim().min(1, "Flight number is required").max(32),
    passengerName: z.string().trim().min(1, "Passenger name is required").max(256),
    threatType: z.string().trim().min(1, "Threat type is required"),
    threatLevel: z.number().int().min(1).max(5),
    screeningEvaluationRaw: RawScreeningEvaluationSchema.refine((value) => value !== "A", {
      message: "A suspect event cannot use the Accept evaluation",
    }),
    screeningStation: z.string().trim().min(1, "Screening station is required"),
    screeningTimestamp: z.string().datetime({ offset: true }),
    externalScanId: z.string().trim().min(1, "External scan ID is required"),
    scanStatus: z.enum(["AVAILABLE", "PENDING", "NOT_FOUND", "FAILED"]),
    imageSetId: z.string().trim().min(1).nullable(),
    images: z.array(screeningImageV1Schema),
  })
  .superRefine((input, context) => {
    if (input.scanStatus === "AVAILABLE" && !input.imageSetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageSetId"],
        message: "AVAILABLE screening scans require an image set",
      });
    }

    if (input.scanStatus === "AVAILABLE" && input.images.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["images"],
        message: "AVAILABLE screening scans require at least one image",
      });
    }
  });

export type ScreeningSimulatorInput = z.infer<typeof screeningSimulatorInputSchema>;

export function parseTrustedSourceSystem(value: unknown): string {
  return trustedSourceSystemSchema.parse(value);
}

/**
 * The credential/configuration owns sourceSystem. A matching body declaration
 * is accepted for contract compatibility, but it is never the trusted value.
 */
export function normalizeScreeningSuspectEvent(
  payload: unknown,
  trustedSourceSystemInput: string,
): ScreeningSuspectEvent {
  const trustedSourceSystem = parseTrustedSourceSystem(trustedSourceSystemInput);
  const untrustedObject = inboundObjectSchema.parse(payload);
  const declaredSourceSystem = untrustedObject.sourceSystem;

  if (declaredSourceSystem !== undefined && declaredSourceSystem !== trustedSourceSystem) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["sourceSystem"],
        message: "sourceSystem does not match the authenticated integration",
      },
    ]);
  }

  return screeningEventV1Schema.parse({
    ...untrustedObject,
    sourceSystem: trustedSourceSystem,
  });
}
