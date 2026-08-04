import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";

import { RFID_ADAPTER_TYPES } from "../adapters/rfidReaderAdapter";
import {
  RfidReadIngestionResultSchema,
} from "./rfidReadEventSchemas";
import { RfidReadError } from "./rfidReadEventErrors";

export interface RfidReadEventRepositoryInput {
  siteId: string;
  readerId: string;
  sourceEventId: string;
  epc: string;
  antennaPort: number;
  rssiDbm: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  readCount: number;
  adapterType: (typeof RFID_ADAPTER_TYPES)[number];
  simulated: boolean;
  receivedAt: string;
  payloadHash: string;
}

export interface RfidReadEventRow {
  id: string;
  siteId: string;
  readerId: string;
  sourceEventId: string;
  epc: string;
  antennaPort: number;
  rssiDbm: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  readCount: number;
  adapterType: (typeof RFID_ADAPTER_TYPES)[number];
  simulated: boolean;
  receivedAt: string;
  payloadHash: string;
  createdAt: string;
}

const rowSchema = RfidReadIngestionResultSchema.omit({ outcome: true })
  .extend({
    payloadHash: z.string().length(64),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

function isRetryableDbError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "40001" || code === "40P01" || code === "55P03";
}

function toRow(value: unknown): RfidReadEventRow {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const parsed = rowSchema.safeParse({
    eventId: record.id,
    siteId: record.site_id,
    readerId: record.reader_id,
    sourceEventId: record.source_event_id,
    epc: record.epc,
    antennaPort: record.antenna_port,
    rssiDbm: record.rssi_dbm ?? null,
    firstSeenAt: record.first_seen_at,
    lastSeenAt: record.last_seen_at,
    readCount: record.read_count,
    adapterType: record.adapter_type,
    simulated: record.simulated,
    receivedAt: record.received_at,
    payloadHash: record.payload_hash,
    createdAt: record.created_at,
  });

  if (!parsed.success) {
    throw new RfidReadError("RFID_READ_PERSISTENCE_FAILED", "RFID read row is invalid", 500, {
      cause: parsed.error,
    });
  }

  return {
    id: parsed.data.eventId,
    siteId: parsed.data.siteId,
    readerId: parsed.data.readerId,
    sourceEventId: parsed.data.sourceEventId,
    epc: parsed.data.epc,
    antennaPort: parsed.data.antennaPort,
    rssiDbm: parsed.data.rssiDbm ?? null,
    firstSeenAt: parsed.data.firstSeenAt,
    lastSeenAt: parsed.data.lastSeenAt,
    readCount: parsed.data.readCount,
    adapterType: parsed.data.adapterType,
    simulated: parsed.data.simulated,
    receivedAt: parsed.data.receivedAt,
    payloadHash: parsed.data.payloadHash,
    createdAt: parsed.data.createdAt,
  };
}

export interface RfidReadEventRepository {
  ingestReadAtomically(input: RfidReadEventRepositoryInput): Promise<RfidReadIngestionResult>;
  getBySourceEvent(siteId: string, readerId: string, sourceEventId: string): Promise<RfidReadEventRow | null>;
  getRecentForReader?(siteId: string, readerId: string, limit?: number): Promise<RfidReadEventRow[]>;
}

async function ingestOnce(input: RfidReadEventRepositoryInput) {
  const { data, error } = await getSupabaseAdminClient().rpc("ingest_beltcon_rfid_read_v1", {
    p_site_id: input.siteId,
    p_reader_id: input.readerId,
    p_source_event_id: input.sourceEventId,
    p_epc: input.epc,
    p_antenna_port: input.antennaPort,
    p_rssi_dbm: input.rssiDbm,
    p_first_seen_at: input.firstSeenAt,
    p_last_seen_at: input.lastSeenAt,
    p_read_count: input.readCount,
    p_adapter_type: input.adapterType,
    p_simulated: input.simulated,
    p_received_at: input.receivedAt,
    p_payload_hash: input.payloadHash,
  });

  if (error) {
    throw error;
  }

  const parsed = RfidReadIngestionResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new RfidReadError("RFID_READ_PERSISTENCE_FAILED", "RFID read ingestion result is invalid", 500, {
      cause: parsed.error,
    });
  }

  return parsed.data;
}

export const rfidReadEventRepository: RfidReadEventRepository = {
  async ingestReadAtomically(input) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await ingestOnce(input);
      } catch (error) {
        if (isRetryableDbError(error) && attempt === 0) {
          continue;
        }
        if (error instanceof RfidReadError) throw error;
        throw new RfidReadError("RFID_READ_PERSISTENCE_FAILED", "RFID read persistence failed", 500, {
          cause: error,
        });
      }
    }

    throw new RfidReadError("RFID_READ_PERSISTENCE_FAILED", "RFID read persistence failed", 500);
  },

  async getBySourceEvent(siteId, readerId, sourceEventId) {
    const { data, error } = await getSupabaseAdminClient()
      .from("rfid_events")
      .select(
        "id,site_id,reader_id,source_event_id,epc,antenna_port,rssi_dbm,first_seen_at,last_seen_at,read_count,adapter_type,simulated,received_at,payload_hash,created_at",
      )
      .eq("site_id", siteId)
      .eq("reader_id", readerId)
      .eq("source_event_id", sourceEventId)
      .maybeSingle();

    if (error) {
      throw new RfidReadError("RFID_READ_PERSISTENCE_FAILED", "RFID read lookup failed", 500, {
        cause: error,
      });
    }

    return data ? toRow(data) : null;
  },

  async getRecentForReader(siteId, readerId, limit = 25) {
    const { data, error } = await getSupabaseAdminClient()
      .from("rfid_events")
      .select(
        "id,site_id,reader_id,source_event_id,epc,antenna_port,rssi_dbm,first_seen_at,last_seen_at,read_count,adapter_type,simulated,received_at,payload_hash,created_at",
      )
      .eq("site_id", siteId)
      .eq("reader_id", readerId)
      .order("received_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new RfidReadError("RFID_READ_PERSISTENCE_FAILED", "RFID read lookup failed", 500, {
        cause: error,
      });
    }

    return (data ?? []).map(toRow);
  },
};
