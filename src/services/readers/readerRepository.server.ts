import "@tanstack/react-start/server-only";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import type { CanonicalRole } from "@/auth/canonicalRoles";

import {
  type ReaderAntennaDetail,
  type ReaderDetail,
  type ReaderHealth,
  type ReaderListFilters,
  type ReaderListResponse,
  type ReaderSummary,
  type UpdateAntennaInput,
  type UpdateReaderInput,
} from "./readerSchemas";

type Row = Record<string, unknown>;

const ONLINE_THRESHOLD_SECONDS = readThreshold("READER_ONLINE_THRESHOLD_SECONDS", 300);
const OFFLINE_THRESHOLD_SECONDS = readThreshold("READER_OFFLINE_THRESHOLD_SECONDS", 3600);
const MAX_ACTIVITY_ROWS = 20_000;

function readThreshold(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 86_400 ? Math.floor(parsed) : fallback;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function latest(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function healthFor(enabled: boolean, lastSeenAt: string | null): ReaderHealth {
  if (!enabled) return "DISABLED";
  if (!lastSeenAt) return "UNKNOWN";
  const ageSeconds = Math.max(0, (Date.now() - new Date(lastSeenAt).getTime()) / 1000);
  if (ageSeconds <= ONLINE_THRESHOLD_SECONDS) return "ONLINE";
  if (ageSeconds <= OFFLINE_THRESHOLD_SECONDS) return "DEGRADED";
  return "OFFLINE";
}

type Activity = {
  readerId: string;
  antennaId: string | null;
  epc: string | null;
  receivedAt: string | null;
  outcome: string | null;
  status: string | null;
};

type AntennaRow = {
  id: string;
  readerId: string;
  port: number;
  name: string;
  zoneCode: string;
  direction: string | null;
  enabled: boolean;
  transmitPowerDbm: number | null;
  version: number;
};

function toAntenna(value: unknown): AntennaRow | null {
  const row = record(value);
  const id = text(row.id);
  const readerId = text(row.reader_id);
  const port = numberValue(row.port_number);
  const name = text(row.name);
  const zoneCode = text(row.zone_code);
  if (!id || !readerId || port === null || !name || !zoneCode) return null;
  return {
    id,
    readerId,
    port,
    name,
    zoneCode,
    direction: text(row.direction),
    enabled: bool(row.enabled, true),
    transmitPowerDbm: numberValue(row.transmit_power_dbm),
    version: numberValue(row.version) ?? 1,
  };
}

function toActivity(value: unknown): Activity | null {
  const row = record(value);
  const readerId = text(row.reader_id);
  if (!readerId) return null;
  return {
    readerId,
    antennaId: text(row.antenna_id),
    epc: text(row.epc),
    receivedAt: text(row.server_received_at) ?? text(row.last_seen),
    outcome: text(row.processing_outcome),
    status: text(row.processing_status),
  };
}

function readerSummary(
  value: unknown,
  antennas: AntennaRow[],
  activity: Activity[],
): ReaderSummary | null {
  const row = record(value);
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  const readerActivity = activity.filter((item) => item.readerId === id);
  const lastReadAt = readerActivity.reduce<string | null>(
    (current, item) => latest(current, item.receivedAt),
    null,
  );
  const mappedAntennas = antennas.filter((antenna) => antenna.readerId === id);
  const enabled = bool(row.enabled, true);
  return {
    id,
    readerCode: id,
    name,
    model: text(row.model),
    vendor: text(row.vendor),
    firmwareVersion: text(row.firmware_version),
    enabled,
    configuredStatus: text(row.status),
    calculatedHealth: healthFor(enabled, lastReadAt),
    lastSeenAt: lastReadAt,
    lastReadAt,
    antennaCount: mappedAntennas.length,
    activeAntennaCount: mappedAntennas.filter((antenna) => antenna.enabled).length,
    mappedZones: [...new Set(mappedAntennas.map((antenna) => antenna.zoneCode))].sort(),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    version: numberValue(row.version) ?? 1,
  };
}

async function loadAntennas(readerIds?: string[]) {
  let query = getSupabaseAdminClient()
    .from("reader_antennas")
    .select("id,reader_id,port_number,name,zone_code,direction,enabled,transmit_power_dbm,version")
    .order("reader_id")
    .order("port_number");
  if (readerIds?.length) query = query.in("reader_id", readerIds);
  const { data, error } = await query.limit(10_000);
  if (error) throw new Error("Unable to load reader antennas", { cause: error });
  return (data ?? []).map(toAntenna).filter((item): item is AntennaRow => item !== null);
}

async function loadActivity(readerIds: string[]) {
  if (readerIds.length === 0) return { activity: [] as Activity[], truncated: false };
  const { data, error } = await getSupabaseAdminClient()
    .from("rfid_events")
    .select(
      "reader_id,antenna_id,epc,server_received_at,last_seen,processing_outcome,processing_status",
    )
    .in("reader_id", readerIds)
    .order("server_received_at", { ascending: false, nullsFirst: false })
    .limit(MAX_ACTIVITY_ROWS + 1);
  if (error) throw new Error("Unable to load reader activity", { cause: error });
  return {
    activity: (data ?? [])
      .slice(0, MAX_ACTIVITY_ROWS)
      .map(toActivity)
      .filter((item): item is Activity => item !== null),
    truncated: (data?.length ?? 0) > MAX_ACTIVITY_ROWS,
  };
}

function filterAndSort(summaries: ReaderSummary[], filters: ReaderListFilters) {
  const search = filters.search?.toLocaleLowerCase();
  const filtered = summaries.filter((reader) => {
    if (search && !`${reader.readerCode} ${reader.name}`.toLocaleLowerCase().includes(search)) {
      return false;
    }
    if (filters.enabled !== undefined && reader.enabled !== filters.enabled) return false;
    if (filters.status && reader.calculatedHealth !== filters.status) return false;
    if (filters.zone && !reader.mappedZones.includes(filters.zone)) return false;
    return true;
  });
  const direction = filters.direction === "desc" ? -1 : 1;
  return filtered.sort((left, right) => {
    const value =
      filters.sort === "name"
        ? left.name.localeCompare(right.name)
        : filters.sort === "health"
          ? left.calculatedHealth.localeCompare(right.calculatedHealth)
          : filters.sort === "lastSeenAt"
            ? (left.lastSeenAt ?? "").localeCompare(right.lastSeenAt ?? "")
            : left.readerCode.localeCompare(right.readerCode);
    return value === 0 ? left.readerCode.localeCompare(right.readerCode) : value * direction;
  });
}

export interface ReaderRepository {
  list(filters: ReaderListFilters): Promise<ReaderListResponse>;
  get(readerId: string): Promise<ReaderDetail | null>;
  updateReader(
    input: UpdateReaderInput & {
      readerId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): Promise<ReaderSummary>;
  updateAntenna(
    input: UpdateAntennaInput & {
      readerId: string;
      antennaId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): Promise<ReaderAntennaDetail>;
  recordRejected(input: {
    actorId: string;
    canonicalRole: CanonicalRole;
    readerId: string;
    antennaId?: string;
    requestId: string;
    code: string;
  }): Promise<void>;
}

export const readerRepository: ReaderRepository = {
  async list(filters) {
    const { data, error } = await getSupabaseAdminClient()
      .from("readers")
      .select("id,name,model,status,enabled,vendor,firmware_version,version,created_at,updated_at")
      .order("id")
      .limit(1_000);
    if (error) throw new Error("Unable to load reader inventory", { cause: error });
    const readerIds = (data ?? [])
      .map((row) => text(record(row).id))
      .filter((id): id is string => Boolean(id));
    const [antennas, activityResult] = await Promise.all([
      loadAntennas(readerIds),
      loadActivity(readerIds),
    ]);
    const summaries = (data ?? [])
      .map((row) => readerSummary(row, antennas, activityResult.activity))
      .filter((item): item is ReaderSummary => item !== null);
    const filtered = filterAndSort(summaries, filters);
    const start = (filters.page - 1) * filters.pageSize;
    return {
      items: filtered.slice(start, start + filters.pageSize),
      page: filters.page,
      pageSize: filters.pageSize,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / filters.pageSize),
      dataLimitations: [
        "Reader health is derived from authoritative RFID activity; no device heartbeat transport is configured.",
        ...(activityResult.truncated
          ? ["Recent RFID activity exceeded the bounded reader-health query limit."]
          : []),
      ],
    };
  },

  async get(readerId) {
    const { data, error } = await getSupabaseAdminClient()
      .from("readers")
      .select("id,name,model,status,enabled,vendor,firmware_version,version,created_at,updated_at")
      .eq("id", readerId)
      .maybeSingle();
    if (error) throw new Error("Unable to load reader", { cause: error });
    if (!data) return null;
    const [antennas, activityResult] = await Promise.all([
      loadAntennas([readerId]),
      loadActivity([readerId]),
    ]);
    const summary = readerSummary(data, antennas, activityResult.activity);
    if (!summary) throw new Error("Stored reader data is invalid");
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const activity = activityResult.activity.filter((item) => item.readerId === readerId);
    const inLast = (milliseconds: number) =>
      activity.filter(
        (item) => item.receivedAt && new Date(item.receivedAt).getTime() >= milliseconds,
      );
    const last24Hours = inLast(dayAgo);
    return {
      ...summary,
      antennas: antennas.map((antenna) => ({
        id: antenna.id,
        port: antenna.port,
        name: antenna.name,
        zoneCode: antenna.zoneCode as ReaderAntennaDetail["zoneCode"],
        direction: antenna.direction,
        enabled: antenna.enabled,
        transmitPowerDbm: antenna.transmitPowerDbm,
        lastReadAt: activity
          .filter((item) => item.antennaId === antenna.id)
          .reduce<string | null>((current, item) => latest(current, item.receivedAt), null),
        version: antenna.version,
      })),
      activity: {
        readsLastHour: inLast(hourAgo).length,
        readsLast24Hours: last24Hours.length,
        uniqueEpcsLast24Hours: new Set(last24Hours.map((item) => item.epc).filter(Boolean)).size,
        unassignedEpcsLast24Hours: last24Hours.filter((item) => item.outcome === "UNASSIGNED_EPC")
          .length,
        processingFailuresLast24Hours: last24Hours.filter(
          (item) => item.status === "FAILED" || item.outcome === "FAILED",
        ).length,
      },
      healthBasis: summary.lastSeenAt ? "RFID_ACTIVITY" : "NO_AUTHORITATIVE_HEALTH_DATA",
    };
  },

  async updateReader(input) {
    const { data, error } = await getSupabaseAdminClient().rpc(
      "update_beltcon_reader_configuration_v1",
      {
        p_reader_id: input.readerId,
        p_name: input.name,
        p_enabled: input.enabled,
        p_model: input.model ?? null,
        p_vendor: input.vendor ?? null,
        p_firmware_version: input.firmwareVersion ?? null,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorId,
        p_canonical_role: input.canonicalRole,
        p_reason: input.reason,
        p_request_id: input.requestId,
      },
    );
    if (error || !data) throw new Error("Unable to update reader configuration", { cause: error });
    const detail = await this.get(input.readerId);
    if (!detail) throw new Error("Reader was not found after configuration update");
    return detail;
  },

  async updateAntenna(input) {
    const { error } = await getSupabaseAdminClient().rpc(
      "update_beltcon_reader_antenna_configuration_v1",
      {
        p_reader_id: input.readerId,
        p_antenna_id: input.antennaId,
        p_name: input.name,
        p_zone_code: input.zoneCode,
        p_direction: input.direction ?? null,
        p_enabled: input.enabled,
        p_transmit_power_dbm: input.transmitPowerDbm,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorId,
        p_canonical_role: input.canonicalRole,
        p_reason: input.reason,
        p_request_id: input.requestId,
      },
    );
    if (error) throw new Error("Unable to update antenna configuration", { cause: error });
    const detail = await this.get(input.readerId);
    const antenna = detail?.antennas.find((candidate) => candidate.id === input.antennaId);
    if (!antenna) throw new Error("Antenna was not found after configuration update");
    return antenna;
  },

  async recordRejected(input) {
    const { error } = await getSupabaseAdminClient()
      .from("audit_events")
      .insert({
        action: "READER_CONFIGURATION_REJECTED",
        actor_type: "USER",
        actor_id: input.actorId,
        canonical_role: input.canonicalRole,
        source_system: "BELTCON_READER_MANAGEMENT",
        outcome: "REJECTED",
        request_id: input.requestId,
        metadata: {
          readerId: input.readerId,
          ...(input.antennaId ? { antennaId: input.antennaId } : {}),
          code: input.code,
        },
      });
    if (error)
      throw new Error("Unable to persist rejected reader configuration audit event", {
        cause: error,
      });
  },
};

export const readerHealthThresholds = {
  onlineSeconds: ONLINE_THRESHOLD_SECONDS,
  offlineSeconds: OFFLINE_THRESHOLD_SECONDS,
} as const;
