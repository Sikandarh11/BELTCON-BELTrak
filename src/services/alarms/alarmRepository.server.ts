import "@tanstack/react-start/server-only";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import type { CanonicalRole } from "@/auth/canonicalRoles";
import {
  ACTIVE_ALARM_WORKFLOW_STATUSES,
  type AlarmListFilters,
  type AlarmSeverity,
  type AlarmWorkflowStatus,
} from "./alarmSchemas";
import { AlarmServiceError } from "./alarmErrors";

export interface AlarmSummary {
  id: string;
  bagId: string;
  bhsUid: string | null;
  epc: string | null;
  rfidTagBarcode: string | null;
  screeningEvaluation: string | null;
  zone: string;
  readerId: string | null;
  antennaPort: number | null;
  severity: AlarmSeverity;
  status: AlarmWorkflowStatus;
  openedAt: string;
  acknowledgedAt: string | null;
  escalatedAt: string | null;
  sentToRecheckAt: string | null;
  assignedTo: string | null;
  version: number;
  currentBagStatus: string | null;
}

export interface AlarmAction {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  reason: string | null;
  notes: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AlarmDetail extends AlarmSummary {
  sourceRfidEventId: string | null;
  actions: AlarmAction[];
}

export interface AlarmListResult {
  alarms: AlarmSummary[];
  page: number;
  pageSize: number;
  total: number;
}

type AlarmMutation = "acknowledge" | "escalate" | "sendToRecheck";

export interface AlarmMutationCommand {
  alarmId: string;
  expectedVersion: number;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  reason?: string;
  notes?: string;
  recheckStationId?: string;
}

function row(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function workflowStatus(value: unknown): AlarmWorkflowStatus {
  return (
    [...ACTIVE_ALARM_WORKFLOW_STATUSES, "CLOSED"].includes(value as AlarmWorkflowStatus)
      ? value
      : "OPEN"
  ) as AlarmWorkflowStatus;
}

function severity(value: unknown): AlarmSeverity {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(value))
    ? (value as AlarmSeverity)
    : "HIGH";
}

function mapAlarm(input: unknown): AlarmSummary {
  const value = row(input);
  const bag = row(value.bags);
  const sourceRead = row(value.source_read);
  const id = string(value.id);
  const bagId = string(value.bag_id);
  const openedAt = string(value.opened_at) ?? string(value.triggered_at);
  if (!id || !bagId || !openedAt) {
    throw new AlarmServiceError("Stored alarm data is invalid", "ALARM_PROCESSING_FAILED", 500);
  }
  return {
    id,
    bagId,
    bhsUid: string(bag.bhs_uid),
    epc: string(bag.epc),
    rfidTagBarcode: string(bag.rfid_tag_barcode),
    screeningEvaluation: string(bag.screening_evaluation),
    zone: string(value.zone_code) ?? string(value.zone) ?? "UNKNOWN",
    readerId: string(sourceRead.reader_id),
    antennaPort: integer(sourceRead.antenna_port),
    severity: severity(value.severity),
    status: workflowStatus(value.outcome),
    openedAt,
    acknowledgedAt: string(value.acknowledged_at),
    escalatedAt: string(value.escalated_at),
    sentToRecheckAt: string(value.sent_to_recheck_at),
    assignedTo: string(value.assigned_to),
    version: integer(value.version) ?? 1,
    currentBagStatus: string(bag.status),
  };
}

function mapAction(input: unknown): AlarmAction {
  const value = row(input);
  const id = string(value.id);
  const action = string(value.action);
  const createdAt = string(value.created_at);
  if (!id || !action || !createdAt) {
    throw new AlarmServiceError(
      "Stored alarm action data is invalid",
      "ALARM_PROCESSING_FAILED",
      500,
    );
  }
  return {
    id,
    action,
    fromStatus: string(value.from_status),
    toStatus: string(value.to_status),
    actorId: string(value.actor_id),
    reason: string(value.reason),
    notes: string(value.notes),
    requestId: string(value.request_id),
    createdAt,
  };
}

const ALARM_SELECT = [
  "id,bag_id,zone,zone_code,triggered_at,opened_at,acknowledged_at,escalated_at,sent_to_recheck_at",
  "outcome,severity,assigned_to,version,source_rfid_event_id",
  "bags!inner(bhs_uid,epc,rfid_tag_barcode,screening_evaluation,status)",
  "source_read:rfid_events!alarms_source_rfid_event_id_fkey(reader_id,antenna_port)",
].join(",");

async function matchingBagIds(search: string) {
  const escaped = search.replace(/[,%()]/g, " ").trim();
  if (!escaped) return [];
  const { data, error } = await getSupabaseAdminClient()
    .from("bags")
    .select("id")
    .or(`bhs_uid.ilike.%${escaped}%,epc.ilike.%${escaped}%`)
    .limit(500);
  if (error) {
    throw new AlarmServiceError("Unable to search alarms", "ALARM_PROCESSING_FAILED", 500, {
      cause: error,
    });
  }
  return (data ?? [])
    .map((candidate) => string(row(candidate).id))
    .filter((id): id is string => Boolean(id));
}

export interface AlarmRepository {
  list(filters: AlarmListFilters): Promise<AlarmListResult>;
  getById(alarmId: string): Promise<AlarmDetail | null>;
  mutate(command: AlarmMutation, input: AlarmMutationCommand): Promise<Record<string, unknown>>;
  recordRejected(input: {
    actorId: string;
    canonicalRole: CanonicalRole;
    alarmId: string;
    requestId: string;
    code: string;
  }): Promise<void>;
}

export const alarmRepository: AlarmRepository = {
  async list(filters) {
    let query = getSupabaseAdminClient()
      .from("alarms")
      .select(ALARM_SELECT, { count: "exact" })
      .order("opened_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });

    const statuses =
      filters.statuses.length > 0 ? filters.statuses : ACTIVE_ALARM_WORKFLOW_STATUSES;
    query = query.in("outcome", statuses);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.zone) query = query.eq("zone_code", filters.zone);
    if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
    if (filters.openedFrom) query = query.gte("opened_at", filters.openedFrom);
    if (filters.openedTo) query = query.lte("opened_at", filters.openedTo);
    if (filters.search) {
      const ids = await matchingBagIds(filters.search);
      if (ids.length === 0) {
        return { alarms: [], page: filters.page, pageSize: filters.pageSize, total: 0 };
      }
      query = query.in("bag_id", ids);
    }

    const start = (filters.page - 1) * filters.pageSize;
    const { data, error, count } = await query.range(start, start + filters.pageSize - 1);
    if (error) {
      throw new AlarmServiceError("Unable to load alarms", "ALARM_PROCESSING_FAILED", 500, {
        cause: error,
      });
    }
    return {
      alarms: (data ?? []).map(mapAlarm),
      page: filters.page,
      pageSize: filters.pageSize,
      total: count ?? 0,
    };
  },

  async getById(alarmId) {
    const { data, error } = await getSupabaseAdminClient()
      .from("alarms")
      .select(ALARM_SELECT)
      .eq("id", alarmId)
      .maybeSingle();
    if (error) {
      throw new AlarmServiceError("Unable to load alarm", "ALARM_PROCESSING_FAILED", 500, {
        cause: error,
      });
    }
    if (!data) return null;
    const { data: actions, error: actionsError } = await getSupabaseAdminClient()
      .from("alarm_actions")
      .select("id,action,from_status,to_status,actor_id,reason,notes,request_id,created_at")
      .eq("alarm_id", alarmId)
      .order("created_at", { ascending: true });
    if (actionsError) {
      throw new AlarmServiceError(
        "Unable to load alarm action history",
        "ALARM_PROCESSING_FAILED",
        500,
        {
          cause: actionsError,
        },
      );
    }
    return {
      ...mapAlarm(data),
      sourceRfidEventId: string(row(data).source_rfid_event_id),
      actions: (actions ?? []).map(mapAction),
    };
  },

  async mutate(command, input) {
    const rpc =
      command === "acknowledge"
        ? "acknowledge_beltcon_alarm_v1"
        : command === "escalate"
          ? "escalate_beltcon_alarm_v1"
          : "send_beltcon_alarm_to_recheck_v1";
    const parameters =
      command === "acknowledge"
        ? {
            p_alarm_id: input.alarmId,
            p_expected_version: input.expectedVersion,
            p_actor_id: input.actorId,
            p_canonical_role: input.canonicalRole,
            p_notes: input.notes ?? null,
            p_request_id: input.requestId,
          }
        : command === "escalate"
          ? {
              p_alarm_id: input.alarmId,
              p_expected_version: input.expectedVersion,
              p_actor_id: input.actorId,
              p_canonical_role: input.canonicalRole,
              p_reason: input.reason ?? null,
              p_notes: input.notes ?? null,
              p_request_id: input.requestId,
            }
          : {
              p_alarm_id: input.alarmId,
              p_expected_version: input.expectedVersion,
              p_actor_id: input.actorId,
              p_canonical_role: input.canonicalRole,
              p_reason: input.reason ?? null,
              p_recheck_station_id: input.recheckStationId ?? null,
              p_request_id: input.requestId,
            };
    const { data, error } = await getSupabaseAdminClient().rpc(rpc, parameters);
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new AlarmServiceError(
        "Unable to process alarm action",
        "ALARM_PROCESSING_FAILED",
        500,
        { cause: error },
      );
    }
    return data as Record<string, unknown>;
  },

  async recordRejected(input) {
    const { error } = await getSupabaseAdminClient()
      .from("audit_events")
      .insert({
        action: "ALARM_ACTION_REJECTED",
        actor_type: "USER",
        actor_id: input.actorId,
        canonical_role: input.canonicalRole,
        source_system: "BELTCON_ALARM_SERVICE",
        outcome: "REJECTED",
        request_id: input.requestId,
        metadata: { alarmId: input.alarmId, code: input.code },
      });
    if (error) {
      throw new AlarmServiceError(
        "Unable to audit rejected alarm action",
        "ALARM_PROCESSING_FAILED",
        500,
        {
          cause: error,
        },
      );
    }
  },
};
