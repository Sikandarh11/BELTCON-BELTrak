import type { Bag, BagStatus } from "@/types";

export type BagRow = {
  id: string;
  source_system?: string | null;
  bhs_uid: string | null;
  iata_code?: string | null;
  iata_origin?: string | null;
  epc: string | null;
  flight: string;
  passenger_name?: string | null;
  threat_type?: string | null;
  threat_level?: number | null;
  screening_station?: string | null;
  screened_at?: string | null;
  status: string;
  current_zone: string | null;
  flagged_at?: string | null;
  tagged_at?: string | null;
  notes?: string | null;
  created_at: string | null;
  updated_at?: string | null;
};

export type BagRowWrite = {
  id: string;
  source_system: string;
  bhs_uid: string | null;
  iata_code: string | null;
  iata_origin: string | null;
  epc: string | null;
  flight: string;
  passenger_name: string | null;
  threat_type: string | null;
  threat_level: number | null;
  screening_station: string | null;
  screened_at: string | null;
  is_suspect: boolean;
  status: string;
  current_zone: string;
  flagged_at: string;
  tagged_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

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
  return {
    id: bag.id,
    source_system: bag.sourceSystem ?? "LEGACY",
    bhs_uid: bag.bhsUid ?? null,
    iata_code: bag.iataCode ?? null,
    iata_origin: bag.iataOrigin ?? null,
    epc: bag.epc ?? null,
    flight: bag.flightNo,
    passenger_name: bag.passengerName ?? null,
    threat_type: bag.threatType ?? null,
    threat_level: bag.threatLevel ?? null,
    screening_station: bag.screeningStation ?? null,
    screened_at: bag.screenedAt ?? null,
    is_suspect: true,
    status: bagStatusToRow(bag.status),
    current_zone: bag.lastSeenZone ?? "TAGGING_STATION",
    flagged_at: bag.flaggedAt,
    tagged_at: bag.taggedAt ?? null,
    notes: bag.notes ?? null,
    created_at: bag.flaggedAt,
    updated_at: bag.updatedAt ?? new Date().toISOString(),
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
    iataCode: row.iata_code ?? undefined,
    iataOrigin: row.iata_origin ?? undefined,
    epc: row.epc ?? undefined,
    flightNo: row.flight,
    passengerName: row.passenger_name ?? undefined,
    threatType: row.threat_type ?? undefined,
    threatLevel: row.threat_level ?? undefined,
    screeningStation: row.screening_station ?? undefined,
    screenedAt: row.screened_at ?? undefined,
    status: rowStatusToBag(row.status),
    flaggedAt,
    taggedAt: row.tagged_at ?? undefined,
    lastSeenZone: row.current_zone ?? undefined,
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}
