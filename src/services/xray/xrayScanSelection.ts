import type { HbssScanResult, XrayScan, XrayScanSelection } from "@/types/xray";

function timestampValue(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareNewest(first: XrayScan, second: XrayScan) {
  const receivedDifference = timestampValue(second.receivedAt) - timestampValue(first.receivedAt);
  if (receivedDifference !== 0) return receivedDifference;

  const createdDifference = timestampValue(second.createdAt) - timestampValue(first.createdAt);
  if (createdDifference !== 0) return createdDifference;

  return second.id.localeCompare(first.id);
}

export function isUsableXrayScan(scan: XrayScan | null): scan is XrayScan {
  return Boolean(scan?.status === "AVAILABLE" && scan.images.length > 0);
}

export function shouldStoreAsSeparateAttempt(
  existing: XrayScan,
  incoming: HbssScanResult,
): boolean {
  const incomingIsUsable = incoming.status === "AVAILABLE" && incoming.images.length > 0;
  return isUsableXrayScan(existing) && !incomingIsUsable;
}

export function selectXrayScans(scans: readonly XrayScan[]): XrayScanSelection {
  const ordered = [...scans].sort(compareNewest);
  return {
    latestAttempt: ordered[0] ?? null,
    displayScan: ordered.find(isUsableXrayScan) ?? null,
  };
}

export function scanForDisplay(selection: XrayScanSelection): XrayScan | null {
  return selection.displayScan ?? selection.latestAttempt;
}
