import type { RfidEvent } from "@/types";
import { useAppStore } from "@/store/appStore";
import { alarmService } from "./alarmService";
import { bagService } from "./bagService";

let eventCounter = 1000;

const EXIT_ZONES = [
  "CUSTOMS_EXIT_GATE_1", "CUSTOMS_EXIT_GATE_2",
  "CUSTOMS_EXIT_GATE_3", "GREEN_CHANNEL_EXIT",
];
const RESTRICTED_ZONES = ["EMPLOYEE_EXIT", "EMERGENCY_DOOR"];
const ALL_ALARM_ZONES = [...EXIT_ZONES, ...RESTRICTED_ZONES];

const EXIT_DEDUP_WINDOW = 500;       // ms — short window at portal
const DEFAULT_DEDUP_WINDOW = 30_000; // ms — 30s in halls

// In-memory dedup cache
const dedupCache = new Map<string, { eventId: string; lastSeen: number }>();

export const eventService = {
  /**
   * Main entry. Every RFID read (real or simulated) calls this.
   * Returns result string for UI feedback.
   */
  ingestRead(
    epc: string,
    readerId: string,
    zone: string,
    rssi: number = -45
  ): "created" | "merged" | "discarded" | "alarm_raised" | "suppressed" {
    const store = useAppStore.getState();

    // 1. Registry check — is this EPC ours?
    const bag = store.bags.find((b) => b.epc === epc);
    if (!bag) {
      console.warn(`[eventService] Foreign EPC ${epc} — discarded`);
      return "discarded";
    }

    // 2. Dedup check
    const dedupKey = `${readerId}:${epc}`;
    const cached = dedupCache.get(dedupKey);
    const now = Date.now();
    const window = EXIT_ZONES.includes(zone)
      ? EXIT_DEDUP_WINDOW
      : DEFAULT_DEDUP_WINDOW;

    if (cached && now - cached.lastSeen < window) {
      const existing = store.events.find((e) => e.id === cached.eventId);
      if (existing) {
        store.updateEvent(cached.eventId, {
          lastSeen: new Date().toISOString(),
          readCount: existing.readCount + 1,
        });
        cached.lastSeen = now;
        return "merged";
      }
    }

    // 3. Create new event
    const eventId = `ev-${++eventCounter}`;
    const ts = new Date().toISOString();
    const event: RfidEvent = {
      id: eventId,
      epc,
      readerId,
      zone,
      eventType: zone.includes("CUSTOMS_EXIT") ? "CUSTOMS_EXIT_DETECTED"
               : zone.includes("EMERGENCY")    ? "ESCAPE_DETECTED"
               : zone.includes("EMPLOYEE")     ? "RESTRICTED_ZONE_DETECTED"
               : zone.includes("RECLAIM")      ? "RECLAIM_DETECTED"
               : zone.includes("TAGGING")      ? "TAG_ENCODED"
               : "ZONE_DETECTED",
      firstSeen: ts,
      lastSeen: ts,
      readCount: 1,
      rssi,
    };
    store.addEvent(event);
    dedupCache.set(dedupKey, { eventId, lastSeen: now });

    // 4. Update bag zone
    store.updateBag(bag.id, { currentZone: zone });

    // 5. Alarm logic
    if (ALL_ALARM_ZONES.includes(zone)) {
      if (bag.status === "RESOLVED") {
        console.log(`[eventService] Suppressed — bag ${bag.id} resolved`);
        return "suppressed";
      }

      const existingAlarm = store.alarms.find(
        (a) => a.bagId === bag.id && a.zone === zone && a.outcome === "OPEN"
      );
      if (existingAlarm) return "merged";

      alarmService.raiseAlarm(bag.id, zone);
      return "alarm_raised";
    }

    // 6. Hall movement transition
    if (bag.status === "TAGGED") {
      try { bagService.transition(bag.id, "IN_ARRIVAL_HALL"); } catch {}
    }

    return "created";
  },

  /** Clear dedup cache (used by simulator reset) */
  clearCache(): void {
    dedupCache.clear();
  },
};
