import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import type {
  RawRfidRead,
  RfidReadHandler,
  RfidReaderAdapter,
  RfidReaderAdapterHealth,
} from "../rfidReaderAdapter";

export interface SimulatedReadInput {
  epc: string;
  antennaPort?: number;
  rssiDbm?: number | null;
  readCount?: number;
  observedAt?: string;
  sourceEventId?: string;
}

export interface SimulatedRfidReaderAdapterOptions {
  readerId: string;
  clock?: () => Date;
  idFactory?: () => string;
}

export class SimulatedRfidReaderAdapter
  implements RfidReaderAdapter
{
  readonly adapterType = "SIMULATED" as const;
  readonly readerId: string;

  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly handlers = new Set<RfidReadHandler>();

  private running = false;
  private startedAt: string | null = null;
  private lastReadAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: SimulatedRfidReaderAdapterOptions) {
    this.readerId = options.readerId;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error("RFID_ADAPTER_START_CANCELLED");
    }

    if (this.running) {
      return;
    }

    this.running = true;
    this.startedAt ??= this.clock().toISOString();
    this.lastError = null;

    signal?.addEventListener(
      "abort",
      () => {
        void this.stop();
      },
      { once: true },
    );
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  subscribe(handler: RfidReadHandler): () => void {
    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }

  async getHealth(): Promise<RfidReaderAdapterHealth> {
    return {
      readerId: this.readerId,
      adapterType: this.adapterType,
      state: this.running ? "SIMULATED" : "OFFLINE",
      connected: this.running,
      startedAt: this.startedAt,
      lastReadAt: this.lastReadAt,
      lastError: this.lastError,
    };
  }

  /**
   * Emits one simulated raw RFID read.
   *
   * This method intentionally does not normalize or validate EPC semantics.
   * P4.3 owns canonical event validation.
   */
  async emitRead(input: SimulatedReadInput): Promise<RawRfidRead> {
    if (!this.running) {
      throw new Error("RFID_SIMULATOR_NOT_RUNNING");
    }

    const observedAt =
      input.observedAt ?? this.clock().toISOString();

    const event: RawRfidRead = {
      sourceEventId: input.sourceEventId ?? this.idFactory(),
      readerId: this.readerId,
      epc: input.epc,
      antennaPort: input.antennaPort ?? 1,
      rssiDbm: input.rssiDbm ?? null,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      readCount: input.readCount ?? 1,
      adapterType: this.adapterType,
      simulated: true,
    };

    this.lastReadAt = observedAt;

    const results = await Promise.allSettled(
      Array.from(this.handlers).map((handler) => Promise.resolve().then(() => handler(event))),
    );

    const failedHandler = results.find(
      (result) => result.status === "rejected",
    );

    if (failedHandler?.status === "rejected") {
      this.lastError = "RFID_READ_HANDLER_FAILED";
    } else {
      this.lastError = null;
    }

    return event;
  }

  async emitBurst(
    input: SimulatedReadInput,
    count: number,
  ): Promise<RawRfidRead[]> {
    if (!Number.isInteger(count) || count < 1 || count > 10_000) {
      throw new Error("RFID_SIMULATOR_INVALID_BURST_COUNT");
    }

    const events: RawRfidRead[] = [];

    for (let index = 0; index < count; index += 1) {
      events.push(
        await this.emitRead({
          ...input,
          sourceEventId: input.sourceEventId
            ? `${input.sourceEventId}-${index + 1}`
            : undefined,
        }),
      );
    }

    return events;
  }

  disconnect(reason = "SIMULATED_READER_DISCONNECTED"): void {
    this.running = false;
    this.lastError = reason;
  }

  async reconnect(): Promise<void> {
    await this.start();
  }
}