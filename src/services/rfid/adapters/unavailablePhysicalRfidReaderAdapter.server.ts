import "@tanstack/react-start/server-only";

import type {
  RfidAdapterType,
  RfidReadHandler,
  RfidReaderAdapter,
  RfidReaderAdapterHealth,
} from "../rfidReaderAdapter";

export interface UnavailablePhysicalAdapterOptions {
  readerId: string;
  adapterType:
    | "UNAVAILABLE_PHYSICAL"
    | "THINGMAGIC_IZAR"
    | "ZEBRA_FX9600";
  disabled?: boolean;
  reason?: string;
}

export class UnavailablePhysicalRfidReaderAdapter
  implements RfidReaderAdapter
{
  readonly readerId: string;
  readonly adapterType: RfidAdapterType;

  private readonly disabled: boolean;
  private readonly reason: string;

  constructor(options: UnavailablePhysicalAdapterOptions) {
    this.readerId = options.readerId;
    this.adapterType = options.adapterType;
    this.disabled = options.disabled ?? false;
    this.reason =
      options.reason ?? "RFID_PHYSICAL_ADAPTER_UNAVAILABLE";
  }

  async start(): Promise<void> {
    if (this.disabled) {
      throw new Error("RFID_READER_DISABLED");
    }

    throw new Error(this.reason);
  }

  async stop(): Promise<void> {
    // Nothing is running.
  }

  subscribe(_handler: RfidReadHandler): () => void {
    return () => {
      // No physical reads are available.
    };
  }

  async getHealth(): Promise<RfidReaderAdapterHealth> {
    return {
      readerId: this.readerId,
      adapterType: this.adapterType,
      state: this.disabled ? "DISABLED" : "MISCONFIGURED",
      connected: false,
      startedAt: null,
      lastReadAt: null,
      lastError: this.disabled ? null : this.reason,
    };
  }
}