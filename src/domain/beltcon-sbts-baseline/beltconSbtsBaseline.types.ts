import type {
  ACKNOWLEDGEMENT_TIMING,
  BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1,
  BHS_BAG_MESSAGE_TYPE_V1,
  BHS_NEW_MESSAGE_TRIGGER,
  BHS_MESSAGE_PROCESSING_OUTCOMES,
  HBSS_RECALL_STATUSES,
  RAW_SCREENING_EVALUATIONS,
  SCREENING_EVALUATIONS,
} from "./beltconSbtsBaseline.constants";

export type BhsMessageType =
  | typeof BHS_BAG_MESSAGE_TYPE_V1
  | typeof BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1;

export type RawScreeningEvaluation = (typeof RAW_SCREENING_EVALUATIONS)[number];
export type ScreeningEvaluation = (typeof SCREENING_EVALUATIONS)[number];
export type BhsMessageProcessingOutcome = (typeof BHS_MESSAGE_PROCESSING_OUTCOMES)[number];
export type HbssRecallStatus = (typeof HBSS_RECALL_STATUSES)[number];

/** A semantic new-message marker; physical transport framing remains deferred. */
export type BhsNewMessageTrigger = typeof BHS_NEW_MESSAGE_TRIGGER;

/** BHS PLC -> SBTS Tagging Station, message type 2001. */
export interface BhsBagMessageV1 {
  messageType: typeof BHS_BAG_MESSAGE_TYPE_V1;
  trigger: BhsNewMessageTrigger;
  lineId: string;
  bhsUid: string;
  evaluation: RawScreeningEvaluation;
}

/** SBTS -> BHS PLC, message type 2002. This deliberately has no wire-byte field. */
export interface BhsAcknowledgementV1 {
  messageType: typeof BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1;
  bhsUid: string;
  outcome: BhsMessageProcessingOutcome;
  timing: typeof ACKNOWLEDGEMENT_TIMING;
}

export type TaggingEligibility = "ELIGIBLE" | "NOT_ELIGIBLE";

/** A future BHS queue adapter can materialize this after durable message processing. */
export interface TaggingQueueItem {
  bhsUid: string;
  lineId: string;
  screeningEvaluation: ScreeningEvaluation;
  eligibility: TaggingEligibility;
  receivedAt: string;
}

/**
 * Scan-and-associate request. Version 1 does not model physical RFID writing
 * or printing; those belong to a later encoder integration.
 */
export interface RfidTagAssociationRequest {
  bagId: string;
  rfidTagBarcode: string;
  epc: string;
  iataLpc?: string | null;
}

export interface HbssRecallRequest {
  bagId: string;
  bhsUid: string;
  stationId: string;
  requestedAt: string;
  requestedBy: string;
}

export interface HbssRecallResult {
  status: HbssRecallStatus;
  requestedAt: string;
  completedAt?: string;
  message?: string;
}

/** Browser-safe semantic boundary. It does not open or access a serial port. */
export interface HbssRecallAdapter {
  recall(request: HbssRecallRequest): Promise<HbssRecallResult>;
}

/** Future boundary for a BHS PLC/Profinet transport adapter. */
export interface BhsInboundAdapter {
  receive(message: BhsBagMessageV1): Promise<BhsAcknowledgementV1>;
}

/** Future boundary for mapping a semantic acknowledgement to the BHS transport. */
export interface BhsAcknowledgementAdapter {
  acknowledge(acknowledgement: BhsAcknowledgementV1): Promise<void>;
}
