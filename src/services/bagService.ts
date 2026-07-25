import type { Bag, BagStatus, ResolutionAction, RfidEvent } from "@/types";
import { useAppStore } from "@/store/appStore";
import { alarmService } from "@/services/alarmService";

export type FlagSuspectInput = {
  id: string;
  bhsUid?: string;
  flightNo: string;
  iataOrigin?: string;
  passengerName?: string;
  threatType?: string;
  notes?: string;
};

export type ResolutionInput = {
  action: ResolutionAction;
  officer: string;
  notes?: string;
};

const EXIT_ZONES = ["CUSTOMS_EXIT", "EMPLOYEE_EXIT", "EMERGENCY_DOOR"];
let eventCounter = 10_000;
let resolutionCounter = 1_000;

function getBag(bagId: string) {
  const bag = useAppStore.getState().bags.find((candidate) => candidate.id === bagId);
  if (!bag) throw new Error(`Bag ${bagId} not found`);
  return bag;
}

function updateLifecycle(bagId: string, status: BagStatus, patch: Partial<Bag> = {}): Bag {
  useAppStore.getState().updateBag(bagId, { ...patch, status });
  return getBag(bagId);
}

function isExitZone(zone: string) {
  return EXIT_ZONES.some((exitZone) => zone.includes(exitZone));
}

export const bagService = {
  async flagSuspect(input: FlagSuspectInput): Promise<Bag> {
    const id = input.id.trim().toUpperCase();
    const store = useAppStore.getState();
    if (!id) throw new Error("Bag ID is required");
    if (store.bags.some((bag) => bag.id.toUpperCase() === id)) {
      throw new Error(`Bag ${id} already exists`);
    }

    const bag: Bag = {
      id,
      bhsUid: input.bhsUid?.trim() || undefined,
      flightNo: input.flightNo.trim().toUpperCase(),
      iataOrigin: input.iataOrigin?.trim().toUpperCase() || undefined,
      passengerName: input.passengerName?.trim() || undefined,
      threatType: input.threatType?.trim() || "Suspect Bag",
      status: "IDENTIFIED",
      flaggedAt: new Date().toISOString(),
      lastSeenZone: "TAGGING_STATION",
      notes: input.notes?.trim() || undefined,
    };

    store.upsertBag(bag);
    store.addAuditEntry({
      action: "BAG_FLAGGED",
      userId: "system",
      userName: "BHS Adaptor",
      detail: `BHS flagged suspect ${bag.id}`,
    });
    return bag;
  },

  async encodeTag(bagId: string, epc: string): Promise<Bag> {
    const store = useAppStore.getState();
    const bag = getBag(bagId);
    const normalizedEpc = epc.trim().toUpperCase();

    if (bag.status !== "IDENTIFIED") {
      throw new Error(`${bag.id} is ${bag.status}; only IDENTIFIED bags can be tagged`);
    }
    if (!normalizedEpc) throw new Error("EPC is required");
    if (
      store.bags.some(
        (candidate) => candidate.id !== bagId && candidate.epc?.toUpperCase() === normalizedEpc,
      )
    ) {
      throw new Error(`EPC ${normalizedEpc} is already bound to another bag`);
    }

    const taggedAt = new Date().toISOString();
    const taggedBag = updateLifecycle(bagId, "TAGGED", {
      epc: normalizedEpc,
      taggedAt,
      lastSeenAt: taggedAt,
      lastSeenZone: "TAGGING_STATION",
    });
    store.addAuditEntry({
      action: "TAG_ENCODED",
      userId: "tagging-station",
      userName: "Tagging Station",
      detail: `Officer Tagging Station tagged ${bag.id} with ${normalizedEpc}`,
    });
    return taggedBag;
  },

  async registerRead(bagId: string, zone: string, readerId: string): Promise<void> {
    const store = useAppStore.getState();
    const bag = getBag(bagId);
    if (!bag.epc) throw new Error(`Tag ${bag.id} at Tagging Station first`);

    const seenAt = new Date().toISOString();
    const event: RfidEvent = {
      id: `ev-${Date.now()}-${++eventCounter}`,
      epc: bag.epc,
      readerId,
      zone,
      eventType: isExitZone(zone) ? "EXIT_PORTAL_READ" : "RFID_READ",
      firstSeen: seenAt,
      lastSeen: seenAt,
      readCount: 1,
      rssi: -42,
    };
    store.addEvent(event);

    if (isExitZone(zone) && (bag.status === "TAGGED" || bag.status === "IN_TRANSIT")) {
      const alarm = alarmService.open({ bagId, zone, severity: "high" });
      updateLifecycle(bagId, "ALARMED", {
        alarmId: alarm.id,
        lastSeenAt: seenAt,
        lastSeenZone: zone,
      });
      return;
    }

    if (bag.status === "TAGGED") {
      updateLifecycle(bagId, "IN_TRANSIT", {
        lastSeenAt: seenAt,
        lastSeenZone: zone,
      });
      return;
    }

    useAppStore.getState().updateBag(bagId, {
      lastSeenAt: seenAt,
      lastSeenZone: zone,
    });
  },

  async sendToRecheck(bagId: string, officer: string): Promise<void> {
    const bag = getBag(bagId);
    if (bag.status !== "ALARMED") {
      throw new Error(`${bag.id} must be ALARMED before it can be sent to recheck`);
    }

    updateLifecycle(bagId, "AT_RECHECK", {
      lastSeenAt: new Date().toISOString(),
      lastSeenZone: "HBSS_RECHECK",
    });
    useAppStore.getState().addAuditEntry({
      action: "BAG_SENT_TO_RECHECK",
      userId: officer,
      userName: officer,
      detail: `Bag ${bag.id} routed to secondary inspection`,
    });
  },

  async resolve(bagId: string, resolution: ResolutionInput): Promise<void> {
    const store = useAppStore.getState();
    const bag = getBag(bagId);
    if (bag.status !== "AT_RECHECK") {
      throw new Error(`${bag.id} must be AT_RECHECK before it can be resolved`);
    }

    const alarm =
      store.alarms.find((candidate) => candidate.id === bag.alarmId) ??
      store.alarms.find(
        (candidate) =>
          candidate.bagId === bagId &&
          ["OPEN", "UNDER_INVESTIGATION", "ESCALATED"].includes(candidate.outcome),
      );
    if (alarm) {
      alarmService.close(alarm.id, resolution.action, resolution.officer);
    }

    store.addResolution({
      id: `res-${Date.now()}-${++resolutionCounter}`,
      bagId,
      officerId: resolution.officer,
      action: resolution.action,
      resolvedAt: new Date().toISOString(),
    });
    updateLifecycle(bagId, "RESOLVED", {
      notes: resolution.notes?.trim() || bag.notes,
      lastSeenAt: new Date().toISOString(),
    });
    store.addAuditEntry({
      action: "BAG_RESOLVED",
      userId: resolution.officer,
      userName: resolution.officer,
      detail: `Bag ${bag.id} resolved: ${resolution.action}`,
    });
  },
};
