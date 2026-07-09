import type { Bag, BagStatus } from "@/types";
import { useAppStore } from "@/store/appStore";

// Legal state transitions — the bag state machine.
// Key = current status, value = allowed next statuses.
const TRANSITIONS: Record<BagStatus, BagStatus[]> = {
  IDENTIFIED: ["TAGGED"],
  TAGGED: ["IN_ARRIVAL_HALL", "AT_EXIT"],
  IN_ARRIVAL_HALL: ["AT_EXIT", "MISSING"],
  AT_EXIT: ["ALARMED"],
  ALARMED: ["UNDER_RECHECK", "ESCALATED"],
  UNDER_RECHECK: ["RESOLVED", "ESCALATED"],
  RESOLVED: [],
  MISSING: ["RESOLVED"],
  ESCAPE_ALERT: ["RESOLVED", "ESCALATED"],
  ESCALATED: ["UNDER_RECHECK", "RESOLVED"],
};

let bagCounter = 100;

export const bagService = {
  /**
   * Called when BHS / simulator flags a suspect bag.
   * Creates a new bag in IDENTIFIED status.
   * isSuspect is always true — binary flag, no threat levels.
   */
  createBagFromSuspectFlag(opts: {
    bhsUid: string;
    iataCode: string;
    flight: string;
  }): Bag {
    const bag: Bag = {
      id: `b${++bagCounter}`,
      bhsUid: opts.bhsUid,
      iataCode: opts.iataCode,
      epc: null,
      flight: opts.flight,
      isSuspect: true,
      status: "IDENTIFIED",
      currentZone: "TAGGING_STATION",
    };
    useAppStore.getState().upsertBag(bag);
    useAppStore.getState().addAuditEntry({
      action: "BAG_FLAGGED",
      userId: "system",
      userName: "BHS Simulator",
      detail: `Bag ${bag.id} (${opts.iataCode}) flagged suspect`,
    });
    return bag;
  },

  /**
   * Called after tag print + verify-after-write succeeds.
   */
  assignEpc(bagId: string, epc: string): void {
    const bag = useAppStore.getState().bags.find((b) => b.id === bagId);
    if (!bag) throw new Error(`Bag ${bagId} not found`);
    this.transition(bagId, "TAGGED");
    useAppStore.getState().updateBag(bagId, { epc });
    useAppStore.getState().addAuditEntry({
      action: "TAG_ENCODED",
      userId: "system",
      userName: "Tagging Station",
      detail: `Bag ${bagId} tagged with EPC ${epc}`,
    });
  },

  /**
   * State machine transition with guard.
   * Throws if transition is illegal (UI should catch + show toast).
   */
  transition(bagId: string, newStatus: BagStatus): void {
    const bag = useAppStore.getState().bags.find((b) => b.id === bagId);
    if (!bag) throw new Error(`Bag ${bagId} not found`);
    const allowed = TRANSITIONS[bag.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Illegal transition: ${bag.status} → ${newStatus} for bag ${bagId}`,
      );
    }
    useAppStore.getState().updateBag(bagId, { status: newStatus });
  },

  /**
   * Update bag zone (no status change — just tracking movement).
   */
  updateZone(bagId: string, zone: string): void {
    useAppStore.getState().updateBag(bagId, { currentZone: zone });
  },
};