import { toast } from "sonner";
import type { Alarm, AlarmOutcome, ResolutionAction } from "@/types";
import { useAppStore } from "@/store/appStore";
import { bagService } from "./bagService";

let alarmCounter = 8000;
let resCounter = 100;

export const alarmService = {
  /**
   * Creates alarm + transitions bag to ALARMED.
   * Called by eventService when exit/restricted zone read fires.
   */
  raiseAlarm(bagId: string, zone: string): Alarm {
    const alarm: Alarm = {
      id: `A-${++alarmCounter}`,
      bagId,
      zone,
      triggeredAt: new Date().toISOString(),
      acknowledgedBy: null,
      outcome: "OPEN",
    };
    useAppStore.getState().addAlarm(alarm);
    toast.error(`Alarm at ${zone.replace(/_/g, " ")}`, {
      description: `Bag ${bagId} — requires immediate attention`,
    });
    try {
      bagService.transition(bagId, "ALARMED");
    } catch {
      // bag may already be alarmed
    }
    return alarm;
  },

  /**
   * Officer clicks "Acknowledge" → alarm goes UNDER_INVESTIGATION,
   * bag goes UNDER_RECHECK.
   */
  acknowledge(alarmId: string, officerName: string): void {
    const alarm = useAppStore.getState().alarms.find((a) => a.id === alarmId);
    if (!alarm) throw new Error(`Alarm ${alarmId} not found`);
    if (alarm.outcome !== "OPEN") return;

    useAppStore.getState().updateAlarm(alarmId, {
      acknowledgedBy: officerName,
      outcome: "UNDER_INVESTIGATION",
    });

    try {
      bagService.transition(alarm.bagId, "UNDER_RECHECK");
    } catch {}
  },

  /**
   * Escalate alarm to supervisor.
   */
  escalate(alarmId: string): void {
    const alarm = useAppStore.getState().alarms.find((a) => a.id === alarmId);
    if (!alarm) return;
    useAppStore.getState().updateAlarm(alarmId, { outcome: "ESCALATED" });
    try {
      bagService.transition(alarm.bagId, "ESCALATED");
    } catch {}
  },

  /**
   * Resolve alarm with one of 5 outcomes.
   * Also creates a Resolution record and sets bag to RESOLVED
   * (except ESCALATED which keeps bag ESCALATED).
   */
  resolve(alarmId: string, action: ResolutionAction, officerId: string): void {
    const store = useAppStore.getState();
    const alarm = store.alarms.find((a) => a.id === alarmId);
    if (!alarm) throw new Error(`Alarm ${alarmId} not found`);

    store.updateAlarm(alarmId, { outcome: action as unknown as AlarmOutcome });

    store.addResolution({
      id: `res-${++resCounter}`,
      bagId: alarm.bagId,
      officerId,
      action,
      resolvedAt: new Date().toISOString(),
    });
    console.log(`[alarmService] Bag ${alarm.bagId} resolved with ${action} — future exit reads will be suppressed`);

    toast.success(`Alarm ${alarmId} resolved`, {
      description: `Action: ${action.replace(/_/g, " ").toLowerCase()}`,
    });

    if (action === "ESCALATED") {
      try { bagService.transition(alarm.bagId, "ESCALATED"); } catch {}
    } else {
      try { bagService.transition(alarm.bagId, "RESOLVED"); } catch {}
    }
  },
};
