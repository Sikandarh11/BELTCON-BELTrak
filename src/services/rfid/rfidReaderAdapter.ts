import "@tanstack/react-start/server-only";

export const RFID_ADAPTER_TYPES = [
  "SIMULATED",
  "UNAVAILABLE_PHYSICAL",
  "THINGMAGIC_IZAR",
  "ZEBRA_FX9600",
] as const;

export type RfidAdapterType = (typeof RFID_ADAPTER_TYPES)[number];

export const RFID_ADAPTER_HEALTH_STATES = [
  "UNKNOWN",
  "STARTING",
  "ONLINE",
  "DEGRADED",
  "OFFLINE",
  "MISCONFIGURED",
  "DISABLED",
  "SIMULATED",
] as const;

export type RfidAdapterHealthState =
  (typeof RFID_ADAPTER_HEALTH_STATES)[number];

/**
 * Raw read produced by a reader adapter.
 *
 * P4.2 only defines and emits this event.
 * Validation, normalization, deduplication and persistence belong to P4.3.
 */
export interface RawRfidRead {
  sourceEventId: string;
  readerId: string;
  epc: string;
  antennaPort: number;
  rssiDbm: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  readCount: number;
  adapterType: RfidAdapterType;
  simulated: boolean;
}

export interface RfidReaderAdapterHealth {
  readerId: string;
  adapterType: RfidAdapterType;
  state: RfidAdapterHealthState;
  connected: boolean;
  startedAt: string | null;
  lastReadAt: string | null;
  lastError: string | null;
}

export type RfidReadHandler = (
  event: RawRfidRead,
) => void | Promise<void>;

export interface RfidReaderAdapter {
  readonly readerId: string;
  readonly adapterType: RfidAdapterType;

  start(signal?: AbortSignal): Promise<void>;

  stop(): Promise<void>;

  subscribe(handler: RfidReadHandler): () => void;

  getHealth(): Promise<RfidReaderAdapterHealth>;
}