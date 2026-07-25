export type { Bag, BagStatus } from "./bag";

export type AlarmOutcome =
  | "OPEN"
  | "UNDER_INVESTIGATION"
  | "CLEARED"
  | "NOT_CLEARED"
  | "DUTY_COLLECTED"
  | "PROHIBITED_ITEM_SEIZED"
  | "ESCALATED"
  | "SUPPRESSED";

export type ResolutionAction =
  | "CLEARED"
  | "NOT_CLEARED"
  | "DUTY_COLLECTED"
  | "PROHIBITED_ITEM_SEIZED"
  | "ESCALATED";

export interface RfidEvent {
  id: string;
  epc: string;
  readerId: string;
  zone: string;
  eventType: string;
  firstSeen: string;
  lastSeen: string;
  readCount: number;
  rssi: number;
}
export interface Alarm {
  id: string;
  bagId: string;
  zone: string;
  triggeredAt: string;
  acknowledgedBy: string | null;
  outcome: AlarmOutcome;
  severity: "low" | "medium" | "high";
}
export interface Resolution {
  id: string;
  bagId: string;
  officerId: string;
  action: ResolutionAction;
  resolvedAt: string;
}
export interface Reader {
  id: string;
  name: string;
  model: string;
  zone: string;
  ip: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  readRate: number;
}
