import { toast } from "sonner";
import type { Alarm, AlarmOutcome, ResolutionAction } from "@/types";
import { useAppStore } from "@/store/appStore";

type OpenAlarmInput = {
  bagId: string;
  zone: string;
  severity: Alarm["severity"];
};

let alarmCounter = 8_000;

export const alarmService = {
  open(input: OpenAlarmInput): Alarm {
    const existing = useAppStore
      .getState()
      .alarms.find(
        (alarm) =>
          alarm.bagId === input.bagId &&
          ["OPEN", "UNDER_INVESTIGATION", "ESCALATED"].includes(alarm.outcome),
      );
    if (existing) return existing;

    const alarm: Alarm = {
      id: `A-${Date.now()}-${++alarmCounter}`,
      bagId: input.bagId,
      zone: input.zone,
      triggeredAt: new Date().toISOString(),
      acknowledgedBy: null,
      outcome: "OPEN",
      severity: input.severity,
    };
    useAppStore.getState().addAlarm(alarm);
    toast.error(`Alarm at ${input.zone.replace(/_/g, " ")}`, {
      description: `Bag ${input.bagId} — requires immediate attention`,
    });
    useAppStore.getState().addAuditEntry({
      action: "ALARM_RAISED",
      userId: "system",
      userName: "System",
      detail: `Alarm ${alarm.id} at ${input.zone} for bag ${input.bagId}`,
    });
    return alarm;
  },

  acknowledge(alarmId: string, officerName: string): void {
    const alarm = useAppStore.getState().alarms.find((candidate) => candidate.id === alarmId);
    if (!alarm) throw new Error(`Alarm ${alarmId} not found`);
    if (alarm.outcome !== "OPEN") return;

    useAppStore.getState().updateAlarm(alarmId, {
      acknowledgedBy: officerName,
      outcome: "UNDER_INVESTIGATION",
    });
    useAppStore.getState().addAuditEntry({
      action: "ALARM_ACKNOWLEDGED",
      userId: officerName,
      userName: officerName,
      detail: `Alarm ${alarmId} acknowledged at ${alarm.zone}`,
    });
  },

  escalate(alarmId: string): void {
    const alarm = useAppStore.getState().alarms.find((candidate) => candidate.id === alarmId);
    if (!alarm) throw new Error(`Alarm ${alarmId} not found`);
    useAppStore.getState().updateAlarm(alarmId, { outcome: "ESCALATED" });
    useAppStore.getState().addAuditEntry({
      action: "ALARM_ESCALATED",
      userId: "system",
      userName: "System",
      detail: `Alarm ${alarmId} escalated`,
    });
  },

  reassign(alarmId: string, officerName: string): void {
    const alarm = useAppStore.getState().alarms.find((candidate) => candidate.id === alarmId);
    if (!alarm) throw new Error(`Alarm ${alarmId} not found`);
    useAppStore.getState().updateAlarm(alarmId, { acknowledgedBy: officerName });
    useAppStore.getState().addAuditEntry({
      action: "ALARM_REASSIGNED",
      userId: officerName,
      userName: officerName,
      detail: `Alarm ${alarmId} reassigned to ${officerName}`,
    });
  },

  close(alarmId: string, action: ResolutionAction, officerName: string): void {
    const alarm = useAppStore.getState().alarms.find((candidate) => candidate.id === alarmId);
    if (!alarm) throw new Error(`Alarm ${alarmId} not found`);
    useAppStore.getState().updateAlarm(alarmId, {
      outcome: action as AlarmOutcome,
      acknowledgedBy: alarm.acknowledgedBy ?? officerName,
    });
    toast.success(`Alarm ${alarmId} closed`, {
      description: `Action: ${action.replace(/_/g, " ").toLowerCase()}`,
    });
  },
};
