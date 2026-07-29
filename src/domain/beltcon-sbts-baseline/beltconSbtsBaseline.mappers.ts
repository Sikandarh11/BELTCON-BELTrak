import {
  ACKNOWLEDGEMENT_TIMING,
  BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1,
  BHS_BAG_MESSAGE_TYPE_V1,
  TAGGING_ELIGIBLE_EVALUATIONS,
} from "./beltconSbtsBaseline.constants";
import {
  BhsBagMessageV1Schema,
  BhsLineIdSchema,
  BhsUidSchema,
  IataLpcSchema,
  RawScreeningEvaluationSchema,
} from "./beltconSbtsBaseline.schemas";
import type {
  BhsAcknowledgementV1,
  BhsBagMessageV1,
  BhsMessageProcessingOutcome,
  RawScreeningEvaluation,
  ScreeningEvaluation,
  TaggingEligibility,
} from "./beltconSbtsBaseline.types";

const EVALUATION_MAP: Record<RawScreeningEvaluation, ScreeningEvaluation> = {
  A: "ACCEPT",
  R: "REJECT",
  T: "TIMEOUT",
  N: "NO_DECISION",
  "?": "MISTRACK",
};

export function normalizeScreeningEvaluation(raw: RawScreeningEvaluation): ScreeningEvaluation {
  return EVALUATION_MAP[RawScreeningEvaluationSchema.parse(raw)];
}

export function isTaggingEligibleEvaluation(value: ScreeningEvaluation): boolean {
  return (TAGGING_ELIGIBLE_EVALUATIONS as readonly string[]).includes(value);
}

export function taggingEligibilityFor(value: ScreeningEvaluation): TaggingEligibility {
  return isTaggingEligibleEvaluation(value) ? "ELIGIBLE" : "NOT_ELIGIBLE";
}

/** Validates and preserves the external BHS BagID exactly as supplied. */
export function validateBhsUid(value: string): string {
  return BhsUidSchema.parse(value);
}

export function validateBhsLineId(value: string): string {
  return BhsLineIdSchema.parse(value);
}

export function validateIataLpc(value: string | null | undefined): string | null | undefined {
  return value == null ? value : IataLpcSchema.parse(value);
}

/**
 * A stable, transport-independent fingerprint for future idempotency storage.
 * It uses length-prefixed fields to avoid delimiter ambiguity and deliberately
 * avoids browser-only or Node-only cryptography APIs.
 */
export function createBhsMessageFingerprint(message: BhsBagMessageV1): string {
  const parsed = BhsBagMessageV1Schema.parse(message);
  const fields = [
    String(BHS_BAG_MESSAGE_TYPE_V1),
    String(parsed.trigger),
    parsed.lineId,
    parsed.bhsUid,
    parsed.evaluation,
  ];

  return `beltcon-sbts-v1:${fields.map((field) => `${field.length}:${field}`).join("|")}`;
}

/** Creates a semantic 2002 acknowledgement after durable processing only. */
export function createSemanticAcknowledgement(
  bhsUid: string,
  outcome: BhsMessageProcessingOutcome,
): BhsAcknowledgementV1 {
  return {
    messageType: BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1,
    bhsUid: validateBhsUid(bhsUid),
    outcome,
    timing: ACKNOWLEDGEMENT_TIMING,
  };
}
