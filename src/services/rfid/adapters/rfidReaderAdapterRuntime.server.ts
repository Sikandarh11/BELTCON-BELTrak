import "@tanstack/react-start/server-only";

import type { ReaderSummary } from "@/services/readers/readerSchemas";
import { readerService, type ReaderService } from "@/services/readers/readerService.server";

import {
  createRfidReaderAdapter,
  type ReaderAdapterConfiguration,
} from "./rfidReaderAdapterFactory.server";
import type {
  RawRfidRead,
  RfidAdapterType,
  RfidReaderAdapter,
  RfidReaderAdapterHealth,
} from "../rfidReaderAdapter";
import { RfidReadError } from "../events/rfidReadEventErrors";
import {
  rfidReadEventService,
  type RfidReadEventService,
} from "../events/rfidReadEventService.server";
import type { RfidReadIngestionResult } from "../events/rfidReadEventSchemas";
import type { SimulatedReadInput } from "./simulatedRfidReaderAdapter.server";

function defaultSiteId() {
  return process.env.SBTS_SITE_ID?.trim() || process.env.BHS_STATION_SITE_ID?.trim() || "ALWAJH";
}

export interface RfidReaderAdapterRuntimeOptions {
  readerService?: ReaderService;
  ingestionService?: RfidReadEventService;
  getSiteId?: () => string;
  simulatorEnabled?: boolean;
  clock?: () => Date;
  idFactory?: () => string;
}

export interface ReaderAdapterHealthView {
  readerId: string;
  readerCode: string;
  readerName: string;
  adapterType: RfidAdapterType;
  enabled: boolean;
  configurationVersion: number;
  health: RfidReaderAdapterHealth;
}

type ReaderCacheEntry = {
  configurationVersion: number;
  adapter: RfidReaderAdapter;
  unsubscribe?: () => void;
};

type IngestionOutcome =
  | { status: "stored"; result: RfidReadIngestionResult }
  | { status: "error"; error: RfidReadError };

export class RfidReaderAdapterRuntime {
  private readonly readerService: ReaderService;
  private readonly ingestionService: RfidReadEventService;
  private readonly getSiteId: () => string;
  private readonly simulatorEnabled: boolean;
  private readonly clock?: () => Date;
  private readonly idFactory?: () => string;
  private readonly adapters = new Map<string, ReaderCacheEntry>();
  private readonly ingestionOutcomes = new Map<string, IngestionOutcome>();

  constructor(options: RfidReaderAdapterRuntimeOptions = {}) {
    this.readerService = options.readerService ?? readerService;
    this.ingestionService = options.ingestionService ?? rfidReadEventService;
    this.getSiteId = options.getSiteId ?? defaultSiteId;
    this.simulatorEnabled = options.simulatorEnabled ?? true;
    this.clock = options.clock;
    this.idFactory = options.idFactory;
  }

  private async loadReader(readerId: string): Promise<ReaderSummary> {
    const reader = await this.readerService.getReaderById(this.getSiteId(), readerId);
    if (!reader) {
      throw new Error("RFID_READER_NOT_FOUND");
    }
    return reader;
  }

  private createAdapter(reader: ReaderSummary): RfidReaderAdapter {
    const configuration: ReaderAdapterConfiguration = {
      readerId: reader.id,
      adapterType: reader.adapterType,
      enabled: reader.enabled,
    };
    return createRfidReaderAdapter(configuration, {
      simulatorEnabled: this.simulatorEnabled,
      clock: this.clock,
      idFactory: this.idFactory,
    });
  }

  private async refreshAdapter(readerId: string): Promise<{
    reader: ReaderSummary;
    adapter: RfidReaderAdapter;
  }> {
    const reader = await this.loadReader(readerId);
    const cached = this.adapters.get(readerId);

    if (cached && cached.configurationVersion === reader.configurationVersion) {
      return { reader, adapter: cached.adapter };
    }

    if (cached) {
      cached.unsubscribe?.();
      await cached.adapter.stop().catch(() => undefined);
      this.adapters.delete(readerId);
    }

    const adapter = this.createAdapter(reader);
    this.adapters.set(readerId, {
      configurationVersion: reader.configurationVersion,
      adapter,
    });
    return { reader, adapter };
  }

  private ingestionKey(readerId: string, sourceEventId: string) {
    return `${readerId}::${sourceEventId}`;
  }

  private attachIngestion(reader: ReaderSummary, adapter: RfidReaderAdapter) {
    const cached = this.adapters.get(reader.id);
    if (cached?.unsubscribe) return;

    const unsubscribe = adapter.subscribe((rawRead) =>
      this.handleIngest(reader, rawRead).then(
        () => undefined,
        (error) => {
          throw error;
        },
      ),
    );

    const current = this.adapters.get(reader.id);
    if (current) {
      current.unsubscribe = unsubscribe;
    }
  }

  private async handleIngest(reader: ReaderSummary, rawRead: RawRfidRead) {
    try {
      const result = await this.ingestionService.ingestTrustedRead({
        trustedSiteId: this.getSiteId(),
        rawRead,
        receivedAt: this.clock ? this.clock().toISOString() : new Date().toISOString(),
      });
      this.ingestionOutcomes.set(this.ingestionKey(reader.id, rawRead.sourceEventId), {
        status: "stored",
        result,
      });
      return result;
    } catch (error) {
      const wrapped =
        error instanceof RfidReadError
          ? error
          : new RfidReadError("RFID_READ_PERSISTENCE_FAILED", "RFID read ingestion failed", 500, {
              cause: error,
            });
      this.ingestionOutcomes.set(this.ingestionKey(reader.id, rawRead.sourceEventId), {
        status: "error",
        error: wrapped,
      });
      throw wrapped;
    }
  }

  private async verifyDurable(
    readerId: string,
    sourceEventId: string,
  ): Promise<RfidReadIngestionResult> {
    const outcome = this.ingestionOutcomes.get(this.ingestionKey(readerId, sourceEventId));
    if (!outcome) {
      throw new RfidReadError("RFID_READ_NOT_DURABLE", "RFID read was not durably stored", 503);
    }
    if (outcome.status === "error") {
      throw outcome.error;
    }
    const persisted = await this.ingestionService.getBySourceEvent(
      this.getSiteId(),
      readerId,
      sourceEventId,
    );
    if (!persisted) {
      throw new RfidReadError("RFID_READ_NOT_DURABLE", "RFID read was not durably stored", 503);
    }
    return outcome.result;
  }

  async getOrCreateAdapter(readerId: string): Promise<RfidReaderAdapter> {
    const { adapter } = await this.refreshAdapter(readerId);
    return adapter;
  }

  async startReader(readerId: string): Promise<RfidReaderAdapterHealth> {
    const { reader, adapter } = await this.refreshAdapter(readerId);
    await adapter.start();
    this.attachIngestion(reader, adapter);
    return adapter.getHealth();
  }

  async stopReader(readerId: string): Promise<RfidReaderAdapterHealth> {
    const { adapter } = await this.refreshAdapter(readerId);
    this.adapters.get(readerId)?.unsubscribe?.();
    await adapter.stop();
    return adapter.getHealth();
  }

  async getReaderAdapterHealth(readerId: string): Promise<RfidReaderAdapterHealth> {
    const adapter = await this.getOrCreateAdapter(readerId);
    return adapter.getHealth();
  }

  async listConfiguredReaders(): Promise<ReaderAdapterHealthView[]> {
    const response = await this.readerService.listReadersForSite(this.getSiteId(), {
      page: 1,
      pageSize: 100,
      sort: "readerCode",
      direction: "asc",
    });

    const simulatedReaders = response.items.filter((reader) => reader.adapterType === "SIMULATED");

    return Promise.all(
      simulatedReaders.map(async (reader) => ({
        readerId: reader.id,
        readerCode: reader.readerCode,
        readerName: reader.name,
        adapterType: reader.adapterType,
        enabled: reader.enabled,
        configurationVersion: reader.configurationVersion,
        health: await this.getReaderAdapterHealth(reader.id),
      })),
    );
  }

  async emitSimulatedRead(
    readerId: string,
    input: SimulatedReadInput & { burstCount?: number },
  ): Promise<RfidReadIngestionResult[]> {
    if (!this.simulatorEnabled) {
      throw new Error("RFID_SIMULATOR_DISABLED");
    }

    const { reader, adapter } = await this.refreshAdapter(readerId);
    if (reader.adapterType !== "SIMULATED") {
      throw new Error("RFID_SIMULATOR_READER_NOT_SUPPORTED");
    }

    if (!reader.enabled) {
      throw new Error("RFID_READER_DISABLED");
    }

    const simulatedAdapter = adapter as RfidReaderAdapter & {
      emitRead: (read: SimulatedReadInput) => Promise<RawRfidRead>;
      emitBurst: (read: SimulatedReadInput, count: number) => Promise<RawRfidRead[]>;
    };

    const burstCount = input.burstCount ?? 1;
    if (burstCount > 1) {
      const reads = await simulatedAdapter.emitBurst(input, burstCount);
      return Promise.all(reads.map((read) => this.verifyDurable(reader.id, read.sourceEventId)));
    }

    const read = await simulatedAdapter.emitRead(input);
    return [await this.verifyDurable(reader.id, read.sourceEventId)];
  }

  reset(readerId?: string) {
    if (readerId) {
      this.adapters.get(readerId)?.unsubscribe?.();
      this.adapters.delete(readerId);
      return;
    }
    for (const entry of this.adapters.values()) {
      entry.unsubscribe?.();
    }
    this.adapters.clear();
  }
}

export const rfidReaderAdapterRuntime = new RfidReaderAdapterRuntime({
  simulatorEnabled: true,
});
