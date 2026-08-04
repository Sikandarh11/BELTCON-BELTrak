import type { BagStatus } from "./bag";
import type { XrayScanStatus } from "./xray";

export type TaggingXrayStatus = XrayScanStatus | "NOT_REQUESTED";
export type BhsConfirmationStatus = "AWAITING_BHS_CONFIRMATION" | "CONFIRMED" | null;
export type TaggingReadiness =
  | "NOT_READY"
  | "AWAITING_BHS"
  | "AWAITING_SCREENING"
  | "AWAITING_XRAY"
  | "READY_FOR_TAGGING"
  | "BLOCKED_CONFLICT";

export interface TaggingBag {
  id: string;
  sourceSystem: string;
  bhsUid: string;
  bhsLineId: string | null;
  screeningEvaluation: string | null;
  screeningReceivedAt: string | null;
  bhsConfirmationStatus: BhsConfirmationStatus;
  bhsConfirmedAt: string | null;
  taggingReadiness: TaggingReadiness;
  canAssignTag: boolean;
  iataCode: string | null;
  iataOrigin: string | null;
  flightNo: string | null;
  passengerName: string | null;
  threatType: string | null;
  threatLevel: number | null;
  screeningStation: string | null;
  screenedAt: string | null;
  status: BagStatus;
  flaggedAt: string;
  taggedAt: string | null;
  epc: string | null;
  rfidTagBarcode: string | null;
  version: number;
  xrayStatus: TaggingXrayStatus;
  xrayViewCount: number;
  rfidState: "NOT_ENCODED" | "ENCODED";
  updatedAt: string | null;
}

export interface PendingTaggingResponse {
  bags: TaggingBag[];
}

export interface EncodeTagResponse {
  bag: TaggingBag;
}

export interface AssignRfidTagRequest {
  rfidTagBarcode: string;
  epc: string;
  iataLpc?: string;
  expectedVersion: number;
}

export interface AssignRfidTagResponse {
  bag: TaggingBag;
}
