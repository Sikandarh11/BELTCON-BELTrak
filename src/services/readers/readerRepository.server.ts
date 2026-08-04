import "@tanstack/react-start/server-only";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import type { CanonicalRole } from "@/auth/canonicalRoles";

import {
  READER_ZONES,
  readerAdapterTypeSchema,
  readerHealthSchema,
  type ReaderAntennaDetail,
  type ReaderDetail,
  type ReaderAdapterType,
  type ReaderHealth,
  type ReaderListFilters,
  type ReaderListResponse,
  type ReaderSummary,
  type CreateReaderConfigurationInput,
  type UpdateReaderConfigurationInput,
  type SetReaderEnabledInput,
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

function normalizeHealth(value: string | null | undefined): ReaderHealth | null {
  return value && readerHealthSchema.safeParse(value).success ? value : null;
}

function resolveReaderHealth(row: Row): ReaderHealth {
  if (!bool(row.enabled, true)) return "DISABLED";
  const adapterType = text(row.adapter_type);
  if (adapterType === "SIMULATED") return "SIMULATED";
  const storedHealth = normalizeHealth(text(row.health_status) ?? text(row.status));
  const lastHeartbeatAt = text(row.last_heartbeat_at);
  const host = text(row.ip) ?? text(row.host);
  if (storedHealth === "ONLINE") return lastHeartbeatAt ? "ONLINE" : host ? "UNKNOWN" : "MISCONFIGURED";
  if (storedHealth === "STARTING" || storedHealth === "DEGRADED" || storedHealth === "OFFLINE") {
    return storedHealth;
  }
  if (storedHealth === "MISCONFIGURED" || storedHealth === "UNKNOWN") return storedHealth;
  if (adapterType && adapterType !== "SIMULATED" && !host) return "MISCONFIGURED";
  return "UNKNOWN";
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
  antennas: AntennaRow[] = [],
  activity: Activity[] = [],
): ReaderSummary | null {
  const row = record(value);
  const id = text(row.id);
  const readerCode = text(row.reader_code) ?? id;
  const siteId = text(row.site_id);
  const name = text(row.name);
  const zone = text(row.zone);
  if (!id || !readerCode || !siteId || !name || !zone || !READER_ZONES.includes(zone as never)) {
    return null;
  }
  const readerActivity = activity.filter((item) => item.readerId === id);
  const lastReadAt = readerActivity.reduce<string | null>(
    (current, item) => latest(current, item.receivedAt),
    null,
  );
  const mappedAntennas = antennas.filter((antenna) => antenna.readerId === id);
  const lastHeartbeatAt = text(row.last_heartbeat_at);
  const lastEventAt = text(row.last_event_at) ?? lastReadAt;
  const healthStatus = resolveReaderHealth(row);
  const configurationVersion = numberValue(row.configuration_version) ?? numberValue(row.version) ?? 1;
  const adapterType = text(row.adapter_type);
  return {
    id,
    readerCode,
    siteId,
    name,
    zone: zone as ReaderSummary["zone"],
    model: text(row.model),
    vendor: text(row.vendor),
    adapterType: adapterTypeSchema.safeParse(adapterType).success
      ? (adapterType as ReaderAdapterType)
      : "UNAVAILABLE_PHYSICAL",
    host: text(row.ip) ?? text(row.host),
    enabled: bool(row.enabled, true),
    healthStatus,
    calculatedHealth: healthStatus,
    lastHeartbeatAt,
    lastEventAt,
    configurationVersion,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    createdBy: text(row.created_by),
    updatedBy: text(row.updated_by),
    firmwareVersion: text(row.firmware_version),
    configuredStatus: text(row.status),
    lastSeenAt: lastHeartbeatAt ?? lastEventAt,
    lastReadAt: lastEventAt,
    antennaCount: mappedAntennas.length,
    activeAntennaCount: mappedAntennas.filter((antenna) => antenna.enabled).length,
    mappedZones: [...new Set([zone, ...mappedAntennas.map((antenna) => antenna.zoneCode)])].sort(),
    version: numberValue(row.version) ?? configurationVersion,
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
  listReadersForSite(input: { siteId: string; filters: ReaderListFilters }): Promise<ReaderListResponse>;
  getReaderById(input: { siteId: string; readerId: string }): Promise<ReaderSummary | null>;
  getReaderByCode(input: { siteId: string; readerCode: string }): Promise<ReaderSummary | null>;
  createReaderConfiguration(
    input: CreateReaderConfigurationInput & {
      siteId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): Promise<ReaderSummary>;
  updateReaderConfiguration(
    input: UpdateReaderConfigurationInput & {
      readerId: string;
      siteId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): Promise<ReaderSummary>;
  setReaderEnabled(
    input: SetReaderEnabledInput & {
      readerId: string;
      siteId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): Promise<ReaderSummary>;
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
  async listReadersForSite({ siteId, filters }) {
    const { data, error } = await getSupabaseAdminClient()
      .from("readers")
      .select(
        "id,reader_code,site_id,name,zone,model,vendor,adapter_type,ip,enabled,status,last_heartbeat_at,last_event_at,configuration_version,created_at,updated_at,created_by,updated_by,version,firmware_version",
      )
      .eq("site_id", siteId)
      .order("reader_code")
      .limit(1_000);
    if (error) throw new Error("Unable to load reader inventory", { cause: error });
    const summaries = (data ?? [])
      .map((row) => readerSummary(row))
      .filter((item): item is ReaderSummary => item !== null);
    const filtered = filterAndSort(summaries, filters);
    const start = (filters.page - 1) * filters.pageSize;
    return {
      items: filtered.slice(start, start + filters.pageSize),
      page: filters.page,
      pageSize: filters.pageSize,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / filters.pageSize),
      dataLimitations: [],
    };
  },

  async getReaderById({ siteId, readerId }) {
    const { data, error } = await getSupabaseAdminClient()
      .from("readers")
      .select(
        "id,reader_code,site_id,name,zone,model,vendor,adapter_type,ip,enabled,status,last_heartbeat_at,last_event_at,configuration_version,created_at,updated_at,created_by,updated_by,version,firmware_version",
      )
      .eq("site_id", siteId)
      .eq("id", readerId)
      .maybeSingle();
    if (error) throw new Error("Unable to load reader", { cause: error });
    return data ? readerSummary(data) : null;
  },

  async getReaderByCode({ siteId, readerCode }) {
    const { data, error } = await getSupabaseAdminClient()
      .from("readers")
      .select(
        "id,reader_code,site_id,name,zone,model,vendor,adapter_type,ip,enabled,status,last_heartbeat_at,last_event_at,configuration_version,created_at,updated_at,created_by,updated_by,version,firmware_version",
      )
      .eq("site_id", siteId)
      .eq("reader_code", readerCode)
      .maybeSingle();
    if (error) throw new Error("Unable to load reader", { cause: error });
    return data ? readerSummary(data) : null;
  },

  async createReaderConfiguration(input) {
    const { data, error } = await getSupabaseAdminClient().rpc(
      "create_beltcon_reader_configuration_v1",
      {
        p_site_id: input.siteId,
        p_reader_code: input.readerCode,
        p_name: input.name,
        p_zone: input.zone,
        p_vendor: input.vendor ?? null,
        p_model: input.model ?? null,
        p_adapter_type: input.adapterType,
        p_host: input.host ?? null,
        p_enabled: input.enabled,
        p_actor_id: input.actorId,
        p_canonical_role: input.canonicalRole,
        p_request_id: input.requestId,
      },
    );
    if (error || !data) throw new Error("Unable to create reader configuration", { cause: error });
    const reader = readerSummary(data);
    if (!reader) throw new Error("Stored reader data is invalid");
    return reader;
  },

  async updateReaderConfiguration(input) {
    const { data, error } = await getSupabaseAdminClient().rpc(
      "update_beltcon_reader_configuration_v1",
      {
        p_reader_id: input.readerId,
        p_site_id: input.siteId,
        p_reader_code: input.readerCode,
        p_name: input.name,
        p_zone: input.zone,
        p_vendor: input.vendor ?? null,
        p_model: input.model ?? null,
        p_adapter_type: input.adapterType,
        p_host: input.host ?? null,
        p_enabled: input.enabled,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorId,
        p_canonical_role: input.canonicalRole,
        p_request_id: input.requestId,
      },
    );
    if (error || !data) throw new Error("Unable to update reader configuration", { cause: error });
    const reader = readerSummary(data);
    if (!reader) throw new Error("Stored reader data is invalid");
    return reader;
  },

  async setReaderEnabled(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("set_beltcon_reader_enabled_v1", {
      p_reader_id: input.readerId,
      p_site_id: input.siteId,
      p_enabled: input.enabled,
      p_expected_version: input.expectedVersion,
      p_actor_id: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
    });
    if (error || !data) throw new Error("Unable to update reader enabled state", { cause: error });
    const reader = readerSummary(data);
    if (!reader) throw new Error("Stored reader data is invalid");
    return reader;
  },

  async list(filters) {
    return this.listReadersForSite({ siteId: process.env.SBTS_SITE_ID?.trim() ?? "ALWAJH", filters });
  },

  async get(readerId) {
    const summary = await this.getReaderById({
      siteId: process.env.SBTS_SITE_ID?.trim() ?? "ALWAJH",
      readerId,
    });
    if (!summary) return null;
    const [antennas, activityResult] = await Promise.all([
      loadAntennas([readerId]),
      loadActivity([readerId]),
    ]);
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
      healthBasis: summary.lastHeartbeatAt ? "RFID_ACTIVITY" : "NO_AUTHORITATIVE_HEALTH_DATA",
    };
  },

  async updateReader(input) {
    return this.updateReaderConfiguration({
      readerId: input.readerId,
      siteId: process.env.SBTS_SITE_ID?.trim() ?? "ALWAJH",
      readerCode: input.readerId,
      name: input.name,
      zone: "OTHER",
      vendor: input.vendor ?? null,
      model: input.model ?? null,
      adapterType: "UNAVAILABLE_PHYSICAL",
      host: null,
      enabled: input.enabled,
      expectedVersion: input.expectedVersion,
      actorId: input.actorId,
      canonicalRole: input.canonicalRole,
      requestId: input.requestId,
    });
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
