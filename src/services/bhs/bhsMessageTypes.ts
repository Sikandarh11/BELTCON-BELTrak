import type {
  BhsAcknowledgementV1,
  BhsBagMessageV1,
  ScreeningEvaluation,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types";

export interface NormalizedBhsMessage {
  messageType: 2001;
  trigger: 1;
  lineId: string;
  bhsUid: string;
  evaluationRaw: BhsBagMessageV1["evaluation"];
  evaluationNormalized: ScreeningEvaluation;
  taggingEligible: boolean;
  sourceSystem: string;
  sourceEventId: string;
  messageFingerprint: string;
  payloadHash: string;
  receivedAt: string;
  requestId: string | null;
}

export type BhsProcessingStatus = "ACCEPTED" | "DUPLICATE" | "CONFLICT" | "FAILED";

export interface BhsAtomicResult {
  status: BhsProcessingStatus;
  integrationEventId: string | null;
  bagId: string | null;
  bhsUid: string;
  lineId: string;
  evaluation: ScreeningEvaluation | null;
  taggingEligible: boolean;
  processingAttemptCount: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface BhsIngestionResult {
  outcome: "ACCEPTED" | "DUPLICATE" | "REJECTED" | "FAILED";
  integrationEventId: string | null;
  bagId: string | null;
  bhsUid: string;
  lineId: string;
  evaluation: ScreeningEvaluation | null;
  taggingEligible: boolean;
  duplicate: boolean;
  processingAttemptCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  acknowledgement: BhsAcknowledgementV1;
}
