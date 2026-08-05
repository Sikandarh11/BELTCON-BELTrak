export const ALARM_OUTPUT_ADAPTER_STATUSES = [
  "TRIGGERED",
  "ALREADY_TRIGGERED",
  "OUTPUT_UNAVAILABLE",
  "FAILED",
] as const;

export type AlarmOutputAdapterStatus = (typeof ALARM_OUTPUT_ADAPTER_STATUSES)[number];

export interface TriggerAlarmOutputInput {
  alarmId: string;
  bagId: string;
  severity?: string | null;
  readerId?: string | null;
  durationMs?: number | null;
}

export interface AlarmOutputResult {
  status: AlarmOutputAdapterStatus;
  alarmId: string;
  bagId: string;
  severity: string;
  readerId: string | null;
  durationMs: number;
  visual: boolean;
  audible: boolean;
  triggeredAt: string | null;
}

export interface AlarmOutputAdapter {
  triggerAlarmOutput(input: TriggerAlarmOutputInput): Promise<AlarmOutputResult>;
}
