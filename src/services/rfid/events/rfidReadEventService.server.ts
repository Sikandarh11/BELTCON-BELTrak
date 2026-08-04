import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { readerService, type ReaderService } from "@/services/readers/readerService.server";

import { RfidReadError, isRfidReadError } from "./rfidReadEventErrors";
import {
  RfidReadIngestionResultSchema,
  TrustedRawRfidReadSchema,
  type RfidReadIngestionResult,
  type TrustedRawRfidRead,
} from "./rfidReadEventSchemas";
import { rfidReadEventRepository, type RfidReadEventRepository } from "./rfidReadEventRepository.server";

const receivedAtSchema = z.string().datetime({ offset: true });

function defaultSiteId() {
  return process.env.SBTS_SITE_ID?.trim() || process.env.BHS_STATION_SITE_ID?.trim() || "ALWAJH";
}

function buildPayloadHash(siteId: string, read: TrustedRawRfidRead) {
  const ordered = [
    siteId,
    read.readerId,
    read.sourceEventId,
    read.epc,
    String(read.antennaPort),
    read.rssiDbm === null ? "" : String(read.rssiDbm),
    read.firstSeenAt,
    read.lastSeenAt,
    String(read.readCount),
    read.adapterType,
    read.simulated ? "1" : "0",
  ].join("\u001f");

  return createHash("sha256").update(ordered).digest("hex");
}

async function loadReader(
  service: ReaderService,
  trustedSiteId: string,
  readerId: string,
) {
  const reader = await service.getReaderById(trustedSiteId, readerId);
  if (reader) return reader;

  const anySite = await service.getReaderByIdAcrossSites(readerId);
  if (anySite) {
    throw new RfidReadError("RFID_READER_SITE_MISMATCH", "Reader belongs to another site", 409);
  }

  throw new RfidReadError("RFID_READER_NOT_FOUND", "Reader was not found", 404);
}

export interface IngestTrustedReadInput {
  trustedSiteId?: string;
  rawRead: unknown;
  receivedAt?: string | Date;
}

export interface RfidReadEventService {
  ingestTrustedRead(input: IngestTrustedReadInput): Promise<RfidReadIngestionResult>;
  getBySourceEvent(siteId: string, readerId: string, sourceEventId: string): ReturnType<RfidReadEventRepository["getBySourceEvent"]>;
}

export function createRfidReadEventService(
  repository: RfidReadEventRepository = rfidReadEventRepository,
  dependencies: { readerService?: ReaderService; clock?: () => Date } = {},
): RfidReadEventService {
  const currentReaderService = dependencies.readerService ?? readerService;
  const clock = dependencies.clock ?? (() => new Date());

  return {
    async ingestTrustedRead(input) {
      const trustedSiteId = input.trustedSiteId?.trim() || defaultSiteId();
      const receivedAt =
        typeof input.receivedAt === "string"
          ? receivedAtSchema.parse(input.receivedAt)
          : (input.receivedAt ?? clock()).toISOString();

      const parsed = TrustedRawRfidReadSchema.safeParse(input.rawRead);
      if (!parsed.success) {
        throw new RfidReadError("RFID_READ_INVALID", "RFID read is invalid", 400, {
          cause: parsed.error,
        });
      }

      const reader = await loadReader(currentReaderService, trustedSiteId, parsed.data.readerId);
      if (!reader.enabled) {
        throw new RfidReadError("RFID_READER_DISABLED", "Reader is disabled", 409);
      }
      if (reader.adapterType !== parsed.data.adapterType) {
        throw new RfidReadError("RFID_ADAPTER_TYPE_MISMATCH", "Reader adapter type does not match", 409);
      }

      const result = await repository.ingestReadAtomically({
        siteId: trustedSiteId,
        readerId: parsed.data.readerId,
        sourceEventId: parsed.data.sourceEventId,
        epc: parsed.data.epc,
        antennaPort: parsed.data.antennaPort,
        rssiDbm: parsed.data.rssiDbm,
        firstSeenAt: parsed.data.firstSeenAt,
        lastSeenAt: parsed.data.lastSeenAt,
        readCount: parsed.data.readCount,
        adapterType: parsed.data.adapterType,
        simulated: parsed.data.simulated,
        receivedAt,
        payloadHash: buildPayloadHash(trustedSiteId, parsed.data),
      });

      return RfidReadIngestionResultSchema.parse(result);
    },

    getBySourceEvent(siteId, readerId, sourceEventId) {
      return repository.getBySourceEvent(siteId, readerId, sourceEventId);
    },
  };
}

export const rfidReadEventService = createRfidReadEventService();

export function isTrustedRfidReadError(value: unknown): value is RfidReadError {
  return isRfidReadError(value);
}
