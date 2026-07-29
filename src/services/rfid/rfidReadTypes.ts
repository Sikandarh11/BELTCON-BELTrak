export type RfidReadOutcome =
  | "BAG_DETECTED"
  | "EXIT_DETECTED"
  | "ALARM_CREATED"
  | "ALARM_ALREADY_ACTIVE"
  | "BAG_ALREADY_RESOLVED"
  | "BAG_ALREADY_AT_RECHECK"
  | "BAG_STATE_CONFLICT"
  | "UNASSIGNED_EPC"
  | "DUPLICATE"
  | "READER_NOT_FOUND"
  | "READER_DISABLED"
  | "ANTENNA_NOT_FOUND"
  | "ANTENNA_DISABLED"
  | "CONFLICT"
  | "FAILED";
export interface RfidReadResult {
  outcome: RfidReadOutcome;
  duplicate: boolean;
  eventId: string | null;
  bagId: string | null;
  bhsUid: string | null;
  epc: string | null;
  readerId: string | null;
  antennaPort: number | null;
  zone: string | null;
  alarmEligible: boolean;
  previousStatus: string | null;
  currentStatus: string | null;
  errorCode: string | null;
  alarm: {
    id: string;
    status: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    created: boolean;
  } | null;
}
