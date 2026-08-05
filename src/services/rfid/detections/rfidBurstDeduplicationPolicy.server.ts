import "@tanstack/react-start/server-only";

export const BASELINE_RFID_ZONES = [
  "TAGGING",
  "CUSTOMS_EXIT",
  "RECHECK",
] as const;

export type BaselineRfidZone =
  (typeof BASELINE_RFID_ZONES)[number];

export const DEFAULT_RFID_BURST_WINDOW_MS = 1_000;
export const MIN_RFID_BURST_WINDOW_MS = 100;
export const MAX_RFID_BURST_WINDOW_MS = 10_000;

export interface RfidBurstDetectionInput {
  siteId: string;
  readerId: string;
  zone: BaselineRfidZone;
  epc: string;
  rfidEventId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  readCount: number;
  rssiDbm: number | null;
}

export interface RfidBurstDetectionResult {
  outcome: "DETECTION_CREATED" | "DETECTION_UPDATED";
  detectionId: string;
  rfidEventId: string;
  readerId: string;
  zone: BaselineRfidZone;
  epc: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  rawEventCount: number;
  totalReadCount: number;
  strongestRssiDbm: number | null;
}

export function isBaselineRfidZone(
  value: string,
): value is BaselineRfidZone {
  return BASELINE_RFID_ZONES.some((zone) => zone === value);
}

export function getRfidBurstWindowMs(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const rawValue = environment.RFID_BURST_WINDOW_MS;

  if (!rawValue) {
    return DEFAULT_RFID_BURST_WINDOW_MS;
  }

  const parsedValue = Number(rawValue);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue < MIN_RFID_BURST_WINDOW_MS ||
    parsedValue > MAX_RFID_BURST_WINDOW_MS
  ) {
    throw new Error("RFID_BURST_WINDOW_INVALID");
  }

  return parsedValue;
}

export function isWithinRfidBurstWindow(input: {
  previousLastDetectedAt: string;
  incomingFirstSeenAt: string;
  windowMs: number;
}): boolean {
  const previousTime = Date.parse(input.previousLastDetectedAt);
  const incomingTime = Date.parse(input.incomingFirstSeenAt);

  if (
    !Number.isFinite(previousTime) ||
    !Number.isFinite(incomingTime)
  ) {
    throw new Error("RFID_BURST_TIMESTAMP_INVALID");
  }

  return incomingTime - previousTime <= input.windowMs;
}