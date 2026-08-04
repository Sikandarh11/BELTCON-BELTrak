export type RecheckAlarmStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "ESCALATED"
  | "SENT_TO_RECHECK"
  | "CLOSED";
export type HbssRecallStatus =
  | "PENDING"
  | "REQUEST_SENT"
  | "SIMULATED"
  | "UNAVAILABLE"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED";
export interface RecheckCase {
  bag: {
    id: string;
    bhsUid: string;
    rfidTagBarcode: string | null;
    epc: string | null;
    screeningEvaluation: string | null;
    status: "AT_RECHECK" | "RESOLVED";
    version: number;
  };
  alarm: {
    id: string;
    status: RecheckAlarmStatus;
    severity: string;
    version: number;
    openedAt: string;
    sentToRecheckAt: string | null;
  };
  lookup: { method: "RFID_TAG_BARCODE" | "EPC" | "BAG_ID" };
  recall: { latestStatus: HbssRecallStatus | null; latestRequestedAt: string | null };
  actions: RecheckAction[];
}
export interface RecheckAction {
  id: string;
  type: string;
  detail: string | null;
  createdAt: string;
}
export interface HbssRecallRecord {
  id: string;
  status: HbssRecallStatus;
  adapterType: string;
  requestedAt: string;
  completedAt: string | null;
  message: string | null;
  errorCode: string | null;
}
export interface RecheckQueueItem {
  bagId: string;
  bhsUid: string;
  rfidTagBarcode: string | null;
  epc: string | null;
  screeningEvaluation: string | null;
  bagStatus: string;
  alarmId: string;
  alarmStatus: RecheckAlarmStatus;
  alarmSeverity: string;
  sentToRecheckAt: string | null;
  stationId: string | null;
  bagVersion: number;
  alarmVersion: number;
}
