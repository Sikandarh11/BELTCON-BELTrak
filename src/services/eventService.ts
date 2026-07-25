import { useAppStore } from "@/store/appStore";
import { bagService } from "@/services/bagService";

const EXIT_DEDUP_WINDOW = 500;
const DEFAULT_DEDUP_WINDOW = 30_000;
const dedupCache = new Map<string, { eventId: string; lastSeen: number }>();

function isExitZone(zone: string) {
  return (
    zone.includes("CUSTOMS_EXIT") ||
    zone.includes("EMPLOYEE_EXIT") ||
    zone.includes("EMERGENCY_DOOR")
  );
}

export const eventService = {
  async ingestRead(
    epc: string,
    readerId: string,
    zone: string,
    _rssi = -45,
  ): Promise<"created" | "merged" | "discarded" | "alarm_raised" | "suppressed"> {
    const store = useAppStore.getState();
    const bag = store.bags.find((candidate) => candidate.epc === epc);
    if (!bag) {
      console.warn(`[eventService] Foreign EPC ${epc} — discarded`);
      return "discarded";
    }
    if (bag.status === "RESOLVED") {
      console.log(`[eventService] Suppressed — bag ${bag.id} resolved`);
      return "suppressed";
    }

    const dedupKey = `${readerId}:${epc}`;
    const cached = dedupCache.get(dedupKey);
    const now = Date.now();
    const dedupWindow = isExitZone(zone) ? EXIT_DEDUP_WINDOW : DEFAULT_DEDUP_WINDOW;
    if (cached && now - cached.lastSeen < dedupWindow) {
      const existing = store.events.find((event) => event.id === cached.eventId);
      if (existing) {
        store.updateEvent(cached.eventId, {
          lastSeen: new Date().toISOString(),
          readCount: existing.readCount + 1,
        });
        cached.lastSeen = now;
        return "merged";
      }
    }

    const statusBeforeRead = bag.status;
    await bagService.registerRead(bag.id, zone, readerId);
    const createdEvent = useAppStore.getState().events[0];
    if (createdEvent) {
      dedupCache.set(dedupKey, { eventId: createdEvent.id, lastSeen: now });
    }
    return isExitZone(zone) && (statusBeforeRead === "TAGGED" || statusBeforeRead === "IN_TRANSIT")
      ? "alarm_raised"
      : "created";
  },

  clearCache(): void {
    dedupCache.clear();
  },
};
