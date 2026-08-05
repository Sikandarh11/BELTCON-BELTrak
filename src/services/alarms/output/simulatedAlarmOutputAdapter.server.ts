import "@tanstack/react-start/server-only";

import type {
  AlarmOutputAdapter,
  AlarmOutputResult,
  TriggerAlarmOutputInput,
} from "./alarmOutputAdapter";

const DEFAULT_DURATION_MS = 5000;

function nowIso(clock?: () => Date) {
  return (clock ?? (() => new Date()))().toISOString();
}

export class SimulatedAlarmOutputAdapter implements AlarmOutputAdapter {
  private readonly clock?: () => Date;
  private readonly triggered = new Map<string, AlarmOutputResult>();

  constructor(options: { clock?: () => Date } = {}) {
    this.clock = options.clock;
  }

  async triggerAlarmOutput(input: TriggerAlarmOutputInput): Promise<AlarmOutputResult> {
    const alarmId = input.alarmId.trim();
    const bagId = input.bagId.trim();
    const severity = (input.severity?.trim() || "HIGH").toUpperCase();
    const durationMs = Number.isFinite(input.durationMs ?? NaN)
      ? Math.max(0, Math.trunc(input.durationMs ?? 0))
      : DEFAULT_DURATION_MS;

    const existing = this.triggered.get(alarmId);
    if (existing) {
      return { ...existing, status: "ALREADY_TRIGGERED" };
    }

    const result: AlarmOutputResult = {
      status: "TRIGGERED",
      alarmId,
      bagId,
      severity,
      readerId: input.readerId?.trim() ?? null,
      durationMs,
      visual: true,
      audible: true,
      triggeredAt: nowIso(this.clock),
    };
    this.triggered.set(alarmId, result);
    return result;
  }

  getTriggeredAlarm(alarmId: string) {
    return this.triggered.get(alarmId.trim()) ?? null;
  }

  reset() {
    this.triggered.clear();
  }
}
