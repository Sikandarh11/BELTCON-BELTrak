import {
  normalizeScreeningEvaluation,
  validateBhsLineId,
  validateBhsUid,
  validateIataLpc,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers";
import { RawScreeningEvaluationSchema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import type { Bag, BagStatus, BeltconSbtsBaselineBag } from "@/types";

export type BagRow = {
  id: string;
  source_system?: string | null;
  bhs_uid: string | null;
  bhs_line_id?: string | null;
  iata_code?: string | null;
  iata_origin?: string | null;
  epc: string | null;
  rfid_tag_barcode?: string | null;
  flight: string;
  passenger_name?: string | null;
  threat_type?: string | null;
  threat_level?: number | null;
  screening_station?: string | null;
  screened_at?: string | null;
  screening_evaluation?: string | null;
  screening_evaluation_raw?: string | null;
  status: string;
  current_zone: string | null;
  flagged_at?: string | null;
  tagged_at?: string | null;
  notes?: string | null;
  created_at: string | null;
  updated_at?: string | null;
  version?: number | null;
};

export type BagRowWrite = {
  id: string;
  source_system: string;
  bhs_uid: string | null;
  bhs_line_id: string | null;
  iata_code: string | null;
  iata_origin: string | null;
  epc: string | null;
  rfid_tag_barcode: string | null;
  flight: string;
  passenger_name: string | null;
  threat_type: string | null;
  threat_level: number | null;
  screening_station: string | null;
  screened_at: string | null;
  screening_evaluation: string | null;
  screening_evaluation_raw: string | null;
  is_suspect: boolean;
  status: string;
  current_zone: string;
  flagged_at: string;
  tagged_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  version?: number;
};

/**
 * Validates a strict BELTCON SBTS baseline DTO without changing the permissive legacy Bag
 * mapping. Phase 3 ingestion must call this before persisting a BHS 2001 bag.
 */
export function validateBeltconSbtsBaselineBag(
  bag: BeltconSbtsBaselineBag,
): BeltconSbtsBaselineBag {
  const raw = RawScreeningEvaluationSchema.parse(bag.screeningEvaluationRaw);
  const screeningEvaluation = normalizeScreeningEvaluation(raw);
  if (bag.screeningEvaluation !== screeningEvaluation) {
    throw new Error("BELTCON SBTS screening raw and normalized evaluations do not match");
  }

  const iataLpc = validateIataLpc(bag.iataLpc ?? bag.iataCode);
  if (bag.iataLpc && bag.iataCode && bag.iataLpc !== bag.iataCode) {
    throw new Error("IATA LPC and legacy IATA code must not disagree");
  }

  if (!Number.isInteger(bag.version) || bag.version < 1) {
    throw new Error("BELTCON SBTS bag version must be an integer greater than or equal to 1");
  }

  return {
    ...bag,
    bhsUid: validateBhsUid(bag.bhsUid),
    bhsLineId: validateBhsLineId(bag.bhsLineId),
    screeningEvaluation,
    screeningEvaluationRaw: raw,
    ...(iataLpc ? { iataLpc, iataCode: iataLpc } : {}),
  };
}

export function bagStatusToRow(status: BagStatus): string {
  const legacyStatus: Record<BagStatus, string> = {
    IDENTIFIED: "IDENTIFIED",
    TAGGED: "TAGGED",
    IN_TRANSIT: "IN_ARRIVAL_HALL",
    ALARMED: "ALARMED",
    AT_RECHECK: "UNDER_RECHECK",
    RESOLVED: "RESOLVED",
    LOST: "MISSING",
  };
  return legacyStatus[status];
}

export function rowStatusToBag(status: string): BagStatus {
  if (status === "IN_ARRIVAL_HALL" || status === "AT_EXIT") return "IN_TRANSIT";
  if (status === "UNDER_RECHECK") return "AT_RECHECK";
  if (status === "MISSING") return "LOST";
  if (status === "ESCAPE_ALERT" || status === "ESCALATED") return "ALARMED";
  if (
    status === "IDENTIFIED" ||
    status === "TAGGED" ||
    status === "ALARMED" ||
    status === "RESOLVED"
  ) {
    return status;
  }
  return "IDENTIFIED";
}

export function bagToRow(bag: Bag): BagRowWrite {
  const iataLpc = bag.iataLpc ?? bag.iataCode;
  if (bag.iataLpc && bag.iataCode && bag.iataLpc !== bag.iataCode) {
    throw new Error("IATA LPC and legacy IATA code must not disagree");
  }

  return {
    id: bag.id,
    source_system: bag.sourceSystem ?? "LEGACY",
    bhs_uid: bag.bhsUid ?? null,
    bhs_line_id: bag.bhsLineId ?? null,
    iata_code: iataLpc ?? null,
    iata_origin: bag.iataOrigin ?? null,
    epc: bag.epc ?? null,
    rfid_tag_barcode: bag.rfidTagBarcode ?? null,
    flight: bag.flightNo,
    passenger_name: bag.passengerName ?? null,
    threat_type: bag.threatType ?? null,
    threat_level: bag.threatLevel ?? null,
    screening_station: bag.screeningStation ?? null,
    screened_at: bag.screenedAt ?? null,
    screening_evaluation: bag.screeningEvaluation ?? null,
    screening_evaluation_raw: bag.screeningEvaluationRaw ?? null,
    is_suspect: true,
    status: bagStatusToRow(bag.status),
    current_zone: bag.lastSeenZone ?? "TAGGING_STATION",
    flagged_at: bag.flaggedAt,
    tagged_at: bag.taggedAt ?? null,
    notes: bag.notes ?? null,
    created_at: bag.flaggedAt,
    updated_at: bag.updatedAt ?? new Date().toISOString(),
    ...(bag.version !== undefined ? { version: bag.version } : {}),
  };
}

export function rowToBag(row: BagRow): Bag {
  const flaggedAt = row.flagged_at ?? row.created_at;
  if (!flaggedAt) {
    throw new Error(`Stored bag ${row.id} has no flagged or created timestamp`);
  }

  return {
    id: row.id,
    sourceSystem: row.source_system ?? "LEGACY",
    bhsUid: row.bhs_uid ?? undefined,
    ...(row.bhs_line_id ? { bhsLineId: row.bhs_line_id } : {}),
    iataCode: row.iata_code ?? undefined,
    iataOrigin: row.iata_origin ?? undefined,
    epc: row.epc ?? undefined,
    ...(row.rfid_tag_barcode ? { rfidTagBarcode: row.rfid_tag_barcode } : {}),
    flightNo: row.flight,
    passengerName: row.passenger_name ?? undefined,
    threatType: row.threat_type ?? undefined,
    threatLevel: row.threat_level ?? undefined,
    screeningStation: row.screening_station ?? undefined,
    screenedAt: row.screened_at ?? undefined,
    ...(row.screening_evaluation
      ? { screeningEvaluation: row.screening_evaluation as Bag["screeningEvaluation"] }
      : {}),
    ...(row.screening_evaluation_raw
      ? { screeningEvaluationRaw: row.screening_evaluation_raw as Bag["screeningEvaluationRaw"] }
      : {}),
    status: rowStatusToBag(row.status),
    flaggedAt,
    taggedAt: row.tagged_at ?? undefined,
    lastSeenZone: row.current_zone ?? undefined,
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    ...(row.version !== null && row.version !== undefined ? { version: row.version } : {}),
  };
}
