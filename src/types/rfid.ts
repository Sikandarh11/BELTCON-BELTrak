import type { Bag, BagStatus } from "./bag";

export const RFID_MOVEMENT_STATUSES = [
  "TAGGED",
  "IN_TRANSIT",
] as const satisfies readonly BagStatus[];

export type RfidMovementStatus = (typeof RFID_MOVEMENT_STATUSES)[number];

export interface RfidTrackableBag extends Omit<Bag, "epc" | "status"> {
  epc: string;
  status: RfidMovementStatus;
}

export interface RfidTrackableBagsResponse {
  bags: RfidTrackableBag[];
}

export function isRfidMovementStatus(status: BagStatus): status is RfidMovementStatus {
  return RFID_MOVEMENT_STATUSES.some((candidate) => candidate === status);
}

export function isRfidTrackableBag(bag: Bag): bag is RfidTrackableBag {
  return Boolean(bag.epc?.trim()) && isRfidMovementStatus(bag.status);
}

export function matchesRfidBagSearch(bag: RfidTrackableBag, search: string): boolean {
  const normalizedSearch = search.trim().toUpperCase();
  if (!normalizedSearch) return true;

  return [bag.id, bag.bhsUid ?? "", bag.epc].some((value) =>
    value.toUpperCase().includes(normalizedSearch),
  );
}
