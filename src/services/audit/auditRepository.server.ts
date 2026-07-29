import "@tanstack/react-start/server-only";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";

import type {
  AuditEventDetail,
  AuditEventSummary,
  AuditFilters,
  AuditListResponse,
  SafeAuditMetadata,
} from "./auditSchemas";

type Row = Record<string, unknown>;
const MAX_AUDIT_ROWS = 10_000;
const SENSITIVE_KEY =
  /password|token|secret|credential|cookie|authorization|service.?role|access.?key|refresh.?key/i;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}
function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
function safeMetadata(
  value: unknown,
  depth = 0,
): SafeAuditMetadata | SafeAuditMetadata[] | string | number | boolean | null {
  if (depth > 4) return "[truncated]";
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => safeMetadata(item, depth + 1) as SafeAuditMetadata);
  const metadata: SafeAuditMetadata = {};
  for (const [key, nested] of Object.entries(row(value))) {
    if (!SENSITIVE_KEY.test(key))
      metadata[key] = safeMetadata(nested, depth + 1) as SafeAuditMetadata;
  }
  return metadata;
}
function target(value: Row) {
  const metadata = row(value.metadata);
  const bagId = text(value.bag_id);
  if (bagId) return { targetType: "BAG", targetId: bagId };
  const xrayScanId = text(value.xray_scan_id);
  if (xrayScanId) return { targetType: "XRAY_SCAN", targetId: xrayScanId };
  const integrationEventId = text(value.integration_event_id);
  if (integrationEventId) return { targetType: "INTEGRATION_EVENT", targetId: integrationEventId };
  const readerId = text(metadata.readerId);
  if (readerId) return { targetType: "READER", targetId: readerId };
  const alarmId = text(metadata.alarmId);
  if (alarmId) return { targetType: "ALARM", targetId: alarmId };
  return { targetType: "OTHER", targetId: null };
}
function readableSummary(value: Row) {
  const metadata = row(value.metadata);
  const bagId = text(value.bag_id) ?? text(metadata.bhsUid) ?? text(metadata.bagId);
  const action = text(value.action) ?? "AUDIT_EVENT";
  const bag = bagId ? ` for BagID ${bagId}` : "";
  const summaries: Record<string, string> = {
    BHS_MESSAGE_ACCEPTED: `BHS message accepted${bag}.`,
    RFID_TAG_ASSIGNED: `RFID tag assigned${bag}.`,
    RFID_TAG_ASSIGNMENT_COMPLETED: `RFID tag assigned${bag}.`,
    CUSTOMS_EXIT_ALARM_OPENED: `Customs Exit alarm opened${bag}.`,
    BAG_SENT_TO_RECHECK: `Bag sent to Recheck${bag}.`,
    HBSS_RECALL_SIMULATED: `Simulated HBSS recall requested${bag}.`,
    BAG_RESOLVED: `Bag resolved${bag}${text(metadata.disposition) ? ` as ${metadata.disposition}` : ""}.`,
    READER_CONFIGURATION_UPDATED: `Reader configuration updated for ${text(metadata.readerId) ?? "reader"}.`,
    ANTENNA_ZONE_MAPPING_CHANGED: `Antenna zone mapping changed for ${text(metadata.antennaId) ?? "antenna"}.`,
  };
  return summaries[action] ?? `${action.replaceAll("_", " ")}${bag}.`;
}
function event(value: unknown, actors: Map<string, string>): AuditEventSummary | null {
  const source = row(value);
  const id = text(source.id);
  const action = text(source.action);
  const createdAt = text(source.created_at);
  if (!id || !action || !createdAt) return null;
  const actorId = text(source.actor_id);
  const targetValue = target(source);
  return {
    id,
    action,
    actorId,
    actorDisplayName: actorId ? (actors.get(actorId) ?? null) : null,
    actorRole: text(source.canonical_role),
    targetType: targetValue.targetType,
    targetId: targetValue.targetId,
    outcome: text(source.outcome) ?? "UNKNOWN",
    summary: readableSummary(source),
    metadata: safeMetadata(source.metadata) as SafeAuditMetadata,
    requestId: text(source.request_id),
    createdAt,
  };
}
function matches(item: AuditEventSummary, filters: AuditFilters) {
  const search = filters.search?.toLocaleLowerCase();
  return (
    (!filters.action || item.action === filters.action) &&
    (!filters.actorId || item.actorId === filters.actorId) &&
    (!filters.targetType || item.targetType === filters.targetType) &&
    (!filters.targetId || item.targetId === filters.targetId) &&
    (!filters.outcome || item.outcome === filters.outcome) &&
    (!filters.requestId || item.requestId === filters.requestId) &&
    (!search ||
      `${item.action} ${item.actorId ?? ""} ${item.targetId ?? ""} ${item.requestId ?? ""} ${item.summary}`
        .toLocaleLowerCase()
        .includes(search))
  );
}
async function actorNames(rows: Row[]) {
  const ids = [
    ...new Set(
      rows
        .map((item) => text(item.actor_id))
        .filter((item): item is string => Boolean(item && /^[0-9a-f-]{36}$/i.test(item))),
    ),
  ];
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await getSupabaseAdminClient()
    .from("profiles")
    .select("id,first_name,last_name,email")
    .in("id", ids);
  if (error) throw new Error("Unable to resolve audit actors", { cause: error });
  return new Map(
    (data ?? []).map((profile) => {
      const source = row(profile);
      const name =
        [text(source.first_name), text(source.last_name)].filter(Boolean).join(" ") ||
        text(source.email) ||
        "Unknown user";
      return [String(source.id), name];
    }),
  );
}

export interface AuditRepository {
  list(filters: AuditFilters): Promise<AuditListResponse>;
  get(auditId: string): Promise<AuditEventDetail | null>;
}

export const auditRepository: AuditRepository = {
  async list(filters) {
    let query = getSupabaseAdminClient()
      .from("audit_events")
      .select(
        "id,action,actor_id,canonical_role,bag_id,xray_scan_id,integration_event_id,source_system,outcome,error_code,request_id,metadata,created_at",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_AUDIT_ROWS);
    if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
    if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
    if (filters.action) query = query.eq("action", filters.action);
    if (filters.actorId) query = query.eq("actor_id", filters.actorId);
    if (filters.outcome) query = query.eq("outcome", filters.outcome);
    if (filters.requestId) query = query.eq("request_id", filters.requestId);
    const { data, error } = await query;
    if (error) throw new Error("Unable to load audit events", { cause: error });
    const rows = (data ?? []).map(row);
    const actors = await actorNames(rows);
    const items = rows
      .map((value) => event(value, actors))
      .filter((item): item is AuditEventSummary => item !== null)
      .filter((item) => matches(item, filters));
    const start = (filters.page - 1) * filters.pageSize;
    return {
      items: items.slice(start, start + filters.pageSize),
      page: filters.page,
      pageSize: filters.pageSize,
      total: items.length,
      totalPages: Math.ceil(items.length / filters.pageSize),
    };
  },

  async get(auditId) {
    const { data, error } = await getSupabaseAdminClient()
      .from("audit_events")
      .select(
        "id,action,actor_id,canonical_role,bag_id,xray_scan_id,integration_event_id,source_system,outcome,error_code,request_id,metadata,created_at",
      )
      .eq("id", auditId)
      .maybeSingle();
    if (error) throw new Error("Unable to load audit event", { cause: error });
    if (!data) return null;
    const source = row(data);
    const summary = event(source, await actorNames([source]));
    if (!summary) throw new Error("Stored audit event is invalid");
    return {
      ...summary,
      bagId: text(source.bag_id),
      xrayScanId: text(source.xray_scan_id),
      integrationEventId: text(source.integration_event_id),
      sourceSystem: text(source.source_system),
      errorCode: text(source.error_code),
    };
  },
};
