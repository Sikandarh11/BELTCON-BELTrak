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
  epc?: string; // set at Tagging Station, unique
  flightNo: string;
  iataOrigin?: string;
  bhsUid?: string; // BHS controller reference
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
