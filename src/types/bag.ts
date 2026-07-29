import type {
  RawScreeningEvaluation,
  ScreeningEvaluation,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types";

export type BagStatus =
  | "IDENTIFIED" // BHS flagged as suspect, not yet tagged
  | "TAGGED" // RFID tag encoded and bound
  | "IN_TRANSIT" // seen by at least one non-exit reader
  | "ALARMED" // read at exit portal, alarm open
  | "AT_RECHECK" // moved to recheck station
  | "RESOLVED" // resolution logged, workflow closed
  | "LOST"; // no reads for N minutes after tagging

export interface Bag {
  id: string; // ETB-XXXXXX
  sourceSystem?: string;
  iataCode?: string; // baggage licence-plate/barcode, normally 10 digits
  /** Preferred domain name for iataCode; both map to bags.iata_code. */
  iataLpc?: string;
  epc?: string; // set at Tagging Station, unique
  flightNo: string;
  iataOrigin?: string;
  bhsUid?: string; // BHS controller reference
  bhsLineId?: string; // BELTCON SBTS baseline BHS line identifier
  screeningEvaluation?: ScreeningEvaluation;
  screeningEvaluationRaw?: RawScreeningEvaluation;
  rfidTagBarcode?: string; // physical RFID label barcode, distinct from EPC
  version?: number; // optimistic-lock version; legacy records may not expose it
  passengerName?: string;
  threatType?: string;
  threatLevel?: number;
  screeningStation?: string;
  screenedAt?: string;
  status: BagStatus;
  flaggedAt: string; // ISO
  taggedAt?: string;
  lastSeenAt?: string;
  lastSeenZone?: string;
  alarmId?: string;
  notes?: string;
  updatedAt?: string;
}

/**
 * Strict DTO for a bag originating from a BELTCON SBTS BHS 2001 message. Legacy
 * screening records intentionally remain represented by the more permissive
 * Bag type while the old simulator is still supported.
 */
export interface BeltconSbtsBaselineBag extends Bag {
  bhsUid: string;
  bhsLineId: string;
  screeningEvaluation: ScreeningEvaluation;
  screeningEvaluationRaw: RawScreeningEvaluation;
  version: number;
}
