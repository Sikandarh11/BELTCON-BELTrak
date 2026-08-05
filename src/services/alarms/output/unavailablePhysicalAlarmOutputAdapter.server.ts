import "@tanstack/react-start/server-only";

import type {
  AlarmOutputAdapter,
  AlarmOutputResult,
  TriggerAlarmOutputInput,
} from "./alarmOutputAdapter";

export class UnavailablePhysicalAlarmOutputAdapter implements AlarmOutputAdapter {
  async triggerAlarmOutput(input: TriggerAlarmOutputInput): Promise<AlarmOutputResult> {
    return {
      status: "OUTPUT_UNAVAILABLE",
      alarmId: input.alarmId.trim(),
      bagId: input.bagId.trim(),
      severity: (input.severity?.trim() || "HIGH").toUpperCase(),
      readerId: input.readerId?.trim() ?? null,
      durationMs: Math.max(0, Math.trunc(input.durationMs ?? 0)),
      visual: false,
      audible: false,
      triggeredAt: null,
    };
  }
}
