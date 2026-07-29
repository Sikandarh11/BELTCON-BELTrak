import { z } from "zod";

import {
  ACKNOWLEDGEMENT_TIMING,
  BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1,
  BHS_BAG_MESSAGE_TYPE_V1,
  BHS_LINE_ID_LENGTH,
  BHS_NEW_MESSAGE_TRIGGER,
  BHS_UID_LENGTH,
  BHS_MESSAGE_PROCESSING_OUTCOMES,
  HBSS_RECALL_STATUSES,
  IATA_LPC_LENGTH,
  RAW_SCREENING_EVALUATIONS,
} from "./beltconSbtsBaseline.constants";

/** Printable US-ASCII only: no whitespace padding, Unicode, or control characters. */
const printableAscii = /^[\x20-\x7E]+$/;
const safeDomainIdentifier = /^[A-Za-z0-9._:-]+$/;
const safeRfidIdentifier = /^[A-Za-z0-9._:/+-]+$/;

export const BhsLineIdSchema = z
  .string()
  .length(BHS_LINE_ID_LENGTH, `BHS Line ID must be exactly ${BHS_LINE_ID_LENGTH} characters.`)
  .regex(printableAscii, "BHS Line ID must contain printable ASCII characters only.")
  .refine((value) => value === value.trim(), "BHS Line ID must not contain transport padding.");

export const BhsUidSchema = z
  .string()
  .length(BHS_UID_LENGTH, `BHS BagID must be exactly ${BHS_UID_LENGTH} characters.`)
  .regex(printableAscii, "BHS BagID must contain printable ASCII characters only.")
  .refine((value) => value === value.trim(), "BHS BagID must not contain transport padding.");

export const IataLpcSchema = z
  .string()
  .regex(
    new RegExp(`^\\d{${IATA_LPC_LENGTH}}$`),
    "IATA Licence Plate Code must be 10 numeric digits.",
  );

export const RawScreeningEvaluationSchema = z.enum(RAW_SCREENING_EVALUATIONS);
export const BhsMessageProcessingOutcomeSchema = z.enum(BHS_MESSAGE_PROCESSING_OUTCOMES);

export const BhsBagMessageV1Schema = z
  .object({
    messageType: z.literal(BHS_BAG_MESSAGE_TYPE_V1),
    trigger: z.literal(BHS_NEW_MESSAGE_TRIGGER),
    lineId: BhsLineIdSchema,
    bhsUid: BhsUidSchema,
    evaluation: RawScreeningEvaluationSchema,
  })
  .strict();

export const BhsAcknowledgementV1Schema = z
  .object({
    messageType: z.literal(BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1),
    bhsUid: BhsUidSchema,
    outcome: BhsMessageProcessingOutcomeSchema,
    timing: z.literal(ACKNOWLEDGEMENT_TIMING),
  })
  .strict();

export const RfidTagAssociationRequestSchema = z
  .object({
    bagId: z.string().min(1).max(128).regex(safeDomainIdentifier),
    rfidTagBarcode: z.string().min(1).max(128).regex(safeRfidIdentifier),
    epc: z.string().min(1).max(256).regex(safeRfidIdentifier),
    iataLpc: IataLpcSchema.nullish(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export const HbssRecallRequestSchema = z
  .object({
    bagId: z.string().min(1).max(128).regex(safeDomainIdentifier),
    bhsUid: BhsUidSchema,
    stationId: z.string().min(1).max(64).regex(safeDomainIdentifier),
    requestedAt: z.string().datetime({ offset: true }),
    requestedBy: z.string().uuid(),
  })
  .strict();

export const HbssRecallResultSchema = z
  .object({
    status: z.enum(HBSS_RECALL_STATUSES),
    requestedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    message: z.string().max(256).optional(),
  })
  .strict();
