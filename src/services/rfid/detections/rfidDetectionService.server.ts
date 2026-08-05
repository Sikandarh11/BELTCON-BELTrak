import "@tanstack/react-start/server-only";

import { readerService, type ReaderService } from "@/services/readers/readerService.server";

import { RfidReadError } from "../events/rfidReadEventErrors";
import { rfidReadEventRepository, type RfidReadEventRepository } from "../events/rfidReadEventRepository.server";
import { getRfidBurstWindowMs, isBaselineRfidZone } from "./rfidBurstDeduplicationPolicy.server";
import { rfidDetectionRepository, type RfidDetectionRepository } from "./rfidDetectionRepository.server";
import { BaselineRfidDetectionResultSchema, type RfidDetectionResult } from "./rfidDetectionSchemas";

export interface ProcessStoredRfidEventInput {
  rfidEventId: string;
}

export interface RfidDetectionService {
  processStoredRfidEvent(input: ProcessStoredRfidEventInput): Promise<RfidDetectionResult>;
}

async function loadReader(service: ReaderService, siteId: string, readerId: string) {
  const reader = await service.getReaderById(siteId, readerId);
  if (reader) return reader;
  const anySite = await service.getReaderByIdAcrossSites(readerId);
  if (anySite) throw new RfidReadError("RFID_READER_SITE_MISMATCH", "Reader belongs to another site", 409);
  throw new RfidReadError("RFID_READER_NOT_FOUND", "Reader was not found", 404);
}

export function createRfidDetectionService(options: {
  readerService?: ReaderService;
  eventRepository?: RfidReadEventRepository;
  detectionRepository?: RfidDetectionRepository;
} = {}): RfidDetectionService {
  const currentReaderService = options.readerService ?? readerService;
  const currentEventRepository = options.eventRepository ?? rfidReadEventRepository;
  const currentDetectionRepository = options.detectionRepository ?? rfidDetectionRepository;

  return {
    async processStoredRfidEvent(input) {
      if (!input.rfidEventId.trim()) {
        throw new RfidReadError("RFID_DETECTION_EVENT_NOT_FOUND", "RFID event was not found", 404);
      }

      const event = await currentEventRepository.getById(input.rfidEventId);
      if (!event) {
        throw new RfidReadError("RFID_DETECTION_EVENT_NOT_FOUND", "RFID event was not found", 404);
      }

      const reader = await loadReader(currentReaderService, event.siteId, event.readerId);
      if (!reader.enabled) {
        throw new RfidReadError("RFID_READER_DISABLED", "Reader is disabled", 409);
      }

      const zone = reader.zone;
      if (!isBaselineRfidZone(zone)) {
        return BaselineRfidDetectionResultSchema.parse({
          outcome: "OPTIONAL_ZONE_IGNORED",
          detectionId: event.id,
          rfidEventId: event.id,
          readerId: event.readerId,
          zone: zone as never,
          epc: event.epc,
          firstDetectedAt: event.firstSeenAt,
          lastDetectedAt: event.lastSeenAt,
          rawEventCount: 0,
          totalReadCount: 0,
          strongestRssiDbm: event.rssiDbm,
          simulated: event.simulated,
          version: 1,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
        });
      }

      getRfidBurstWindowMs();
      const result = await currentDetectionRepository.processStoredRfidEventAtomically({
        rfidEventId: event.id,
      });
      return BaselineRfidDetectionResultSchema.parse(result);
    },
  };
}

export const rfidDetectionService = createRfidDetectionService();
