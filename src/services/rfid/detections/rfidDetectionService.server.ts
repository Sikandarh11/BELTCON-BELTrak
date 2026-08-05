import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import { readerService, type ReaderService } from "@/services/readers/readerService.server";

import { RfidReadError } from "../events/rfidReadEventErrors";
import {
  rfidReadEventRepository,
  type RfidReadEventRepository,
} from "../events/rfidReadEventRepository.server";
import {
  RfidDeduplicationPolicySchema,
  RfidDetectionResultSchema,
  RfidReadPointSchema,
  type RfidDetectionResult,
  type RfidReadPoint,
} from "./rfidDetectionSchemas";
import {
  rfidDetectionRepository,
  type ProcessStoredRfidEventInput,
  type RfidDetectionRepository,
} from "./rfidDetectionRepository.server";

const readPointRowSchema = z
  .object({
    id: z.string().uuid(),
    site_id: z.string(),
    reader_id: z.string(),
    antenna_port: z.number().int().nullable(),
    code: z.string(),
    name: z.string(),
    zone: z.string(),
    enabled: z.boolean(),
    dedup_window_ms: z.number().int(),
    late_arrival_tolerance_ms: z.number().int(),
    include_antenna_in_key: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

async function loadReadPoint(siteId: string, readerId: string, antennaPort: number) {
  const client = getSupabaseAdminClient();
  const query = client
    .from("rfid_read_points")
    .select(
      "id,site_id,reader_id,antenna_port,code,name,zone,enabled,dedup_window_ms,late_arrival_tolerance_ms,include_antenna_in_key,created_at,updated_at",
    )
    .eq("site_id", siteId)
    .eq("reader_id", readerId)
    .order("antenna_port", { ascending: true, nullsFirst: false });

  const exact = await query.eq("antenna_port", antennaPort).maybeSingle();
  if (exact.error) {
    throw new RfidReadError("RFID_READ_POINT_NOT_FOUND", "Read point lookup failed", 500, {
      cause: exact.error,
    });
  }
  if (exact.data) return RfidReadPointSchema.parse(normalizeReadPoint(exact.data));

  const fallback = await client
    .from("rfid_read_points")
    .select(
      "id,site_id,reader_id,antenna_port,code,name,zone,enabled,dedup_window_ms,late_arrival_tolerance_ms,include_antenna_in_key,created_at,updated_at",
    )
    .eq("site_id", siteId)
    .eq("reader_id", readerId)
    .is("antenna_port", null)
    .maybeSingle();
  if (fallback.error) {
    throw new RfidReadError("RFID_READ_POINT_NOT_FOUND", "Read point lookup failed", 500, {
      cause: fallback.error,
    });
  }
  if (!fallback.data) {
    throw new RfidReadError("RFID_ANTENNA_MAPPING_MISSING", "Antenna mapping is missing", 422);
  }
  return RfidReadPointSchema.parse(normalizeReadPoint(fallback.data));
}

function normalizeReadPoint(row: unknown) {
  const parsed = readPointRowSchema.parse(row);
  return {
    id: parsed.id,
    siteId: parsed.site_id,
    readerId: parsed.reader_id,
    antennaPort: parsed.antenna_port,
    code: parsed.code,
    name: parsed.name,
    zone: parsed.zone,
    enabled: parsed.enabled,
    dedupWindowMs: parsed.dedup_window_ms,
    lateArrivalToleranceMs: parsed.late_arrival_tolerance_ms,
    includeAntennaInKey: parsed.include_antenna_in_key,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

async function loadReader(service: ReaderService, siteId: string, readerId: string) {
  const reader = await service.getReaderById(siteId, readerId);
  if (reader) return reader;

  const anySite = await service.getReaderByIdAcrossSites(readerId);
  if (anySite) {
    throw new RfidReadError("RFID_READER_SITE_MISMATCH", "Reader belongs to another site", 409);
  }

  throw new RfidReadError("RFID_READER_NOT_FOUND", "Reader was not found", 404);
}

export interface ProcessStoredRfidEventOptions {
  readerService?: ReaderService;
  eventRepository?: RfidReadEventRepository;
  detectionRepository?: RfidDetectionRepository;
  loadReadPoint?: (
    siteId: string,
    readerId: string,
    antennaPort: number,
  ) => Promise<RfidReadPoint | null>;
}

export interface RfidDetectionService {
  processStoredRfidEvent(input: ProcessStoredRfidEventInput): Promise<RfidDetectionResult>;
}

export function createRfidDetectionService(
  options: ProcessStoredRfidEventOptions = {},
): RfidDetectionService {
  const currentReaderService = options.readerService ?? readerService;
  const currentEventRepository = options.eventRepository ?? rfidReadEventRepository;
  const currentDetectionRepository = options.detectionRepository ?? rfidDetectionRepository;
  const currentReadPointLoader = options.loadReadPoint ?? loadReadPoint;

  return {
    async processStoredRfidEvent(input) {
      if (!input.rfidEventId.trim()) {
        throw new RfidReadError(
          "RFID_DETECTION_EVENT_NOT_FOUND",
          "RFID event was not found",
          404,
        );
      }

      const event = await currentEventRepository.getById(input.rfidEventId);
      if (!event) {
        throw new RfidReadError(
          "RFID_DETECTION_EVENT_NOT_FOUND",
          "RFID event was not found",
          404,
        );
      }

      const reader = await loadReader(currentReaderService, event.siteId, event.readerId);
      if (!reader.enabled) {
        throw new RfidReadError("RFID_READER_DISABLED", "Reader is disabled", 409);
      }

      const readPoint = await currentReadPointLoader(event.siteId, event.readerId, event.antennaPort);
      if (!readPoint) {
        throw new RfidReadError(
          "RFID_ANTENNA_MAPPING_MISSING",
          "Antenna mapping is missing",
          422,
        );
      }
      const dedupPolicy = RfidDeduplicationPolicySchema.parse({
        windowMs: readPoint.dedupWindowMs,
        lateArrivalToleranceMs: readPoint.lateArrivalToleranceMs,
        includeAntennaInKey: readPoint.includeAntennaInKey,
      });
      if (!readPoint.enabled) {
        throw new RfidReadError("RFID_READ_POINT_DISABLED", "Read point is disabled", 409);
      }

      if (
        dedupPolicy.windowMs < 100 ||
        dedupPolicy.windowMs > 60_000 ||
        dedupPolicy.lateArrivalToleranceMs < 0 ||
        dedupPolicy.lateArrivalToleranceMs > 300_000
      ) {
        throw new RfidReadError(
          "RFID_DEDUP_POLICY_INVALID",
          "Deduplication policy is invalid",
          422,
        );
      }

      const result = await currentDetectionRepository.processStoredRfidEventAtomically({
        rfidEventId: event.id,
      });

      return RfidDetectionResultSchema.parse(result);
    },
  };
}

export const rfidDetectionService = createRfidDetectionService();
