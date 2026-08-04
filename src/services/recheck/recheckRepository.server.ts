import "@tanstack/react-start/server-only";
import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import type { CanonicalRole } from "@/auth/canonicalRoles";
import { RecheckServiceError } from "./recheckErrors";
import type { RecheckQueueFilters } from "./recheckSchemas";
import type {
  HbssRecallRecord,
  HbssRecallStatus,
  RecheckAction,
  RecheckCase,
  RecheckQueueItem,
} from "./recheckTypes";

const activeStatuses = ["OPEN", "ACKNOWLEDGED", "ESCALATED", "SENT_TO_RECHECK"];
const recallStatuses = new Set<HbssRecallStatus>([
  "PENDING",
  "REQUEST_SENT",
  "SIMULATED",
  "UNAVAILABLE",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
]);
const asRow = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const number = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) ? value : 1;
function mapQueue(value: unknown): RecheckQueueItem {
  const row = asRow(value);
  const bag = asRow(row.bags);
  const id = text(row.id);
  const bagId = text(row.bag_id);
  const bhsUid = text(bag.bhs_uid);
  if (!id || !bagId || !bhsUid)
    throw new RecheckServiceError(
      "Stored Recheck queue data is invalid",
      "RECHECK_PROCESSING_FAILED",
      500,
    );
  return {
    bagId,
    bhsUid,
    rfidTagBarcode: text(bag.rfid_tag_barcode),
    epc: text(bag.epc),
    screeningEvaluation: text(bag.screening_evaluation),
    bagStatus: text(bag.status) ?? "UNDER_RECHECK",
    alarmId: id,
    alarmStatus: (text(row.outcome) ?? "SENT_TO_RECHECK") as RecheckQueueItem["alarmStatus"],
    alarmSeverity: text(row.severity) ?? "HIGH",
    sentToRecheckAt: text(row.sent_to_recheck_at),
    stationId: text(bag.current_zone),
    bagVersion: number(bag.version),
    alarmVersion: number(row.version),
  };
}
function mapRecall(value: unknown): HbssRecallRecord {
  const row = asRow(value);
  const id = text(row.id);
  const status = text(row.status);
  const adapterType = text(row.adapter_type);
  const requestedAt = text(row.requested_at);
  if (
    !id ||
    !status ||
    !recallStatuses.has(status as HbssRecallStatus) ||
    !adapterType ||
    !requestedAt
  )
    throw new RecheckServiceError(
      "Stored HBSS recall data is invalid",
      "RECHECK_PROCESSING_FAILED",
      500,
    );
  return {
    id,
    status: status as HbssRecallStatus,
    adapterType,
    requestedAt,
    completedAt: text(row.completed_at),
    message: text(row.error_message) ?? text(asRow(row.response_metadata).message),
    errorCode: text(row.error_code),
  };
}
function mapActions(values: unknown[]): RecheckAction[] {
  return values.map((value) => {
    const row = asRow(value);
    const id = text(row.id);
    const action = text(row.action);
    const at = text(row.created_at);
    if (!id || !action || !at)
      throw new RecheckServiceError(
        "Stored Recheck action data is invalid",
        "RECHECK_PROCESSING_FAILED",
        500,
      );
    return { id, type: action, detail: text(row.reason) ?? text(row.notes), createdAt: at };
  });
}
const SELECT =
  "id,bag_id,outcome,severity,version,opened_at,sent_to_recheck_at,bags!inner(id,bhs_uid,rfid_tag_barcode,epc,screening_evaluation,status,version,current_zone)";
export const recheckRepository = {
  async queue(filters: RecheckQueueFilters) {
    let query = getSupabaseAdminClient()
      .from("alarms")
      .select(SELECT, { count: "exact" })
      .eq("bags.status", "UNDER_RECHECK")
      .in("outcome", filters.alarmStatus ? [filters.alarmStatus] : activeStatuses)
      .order("sent_to_recheck_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (filters.stationId) query = query.eq("bags.current_zone", filters.stationId);
    if (filters.search) {
      const scan = filters.search.replace(/[,%()]/g, " ").trim();
      query = query.or(
        `bhs_uid.ilike.%${scan}%,rfid_tag_barcode.ilike.%${scan}%,epc.ilike.%${scan}%`,
        { foreignTable: "bags" },
      );
    }
    const start = (filters.page - 1) * filters.pageSize;
    const { data, error, count } = await query.range(start, start + filters.pageSize - 1);
    if (error)
      throw new RecheckServiceError(
        "Unable to load Recheck queue",
        "RECHECK_PROCESSING_FAILED",
        500,
        { cause: error },
      );
    return {
      items: (data ?? []).map(mapQueue),
      page: filters.page,
      pageSize: filters.pageSize,
      total: count ?? 0,
    };
  },
  async caseForBag(bagId: string, method: RecheckCase["lookup"]["method"] = "BAG_ID") {
    const { data, error } = await getSupabaseAdminClient()
      .from("alarms")
      .select(SELECT)
      .eq("bag_id", bagId)
      .in("outcome", activeStatuses)
      .maybeSingle();
    if (error)
      throw new RecheckServiceError(
        "Unable to load Recheck case",
        "RECHECK_PROCESSING_FAILED",
        500,
        { cause: error },
      );
    if (!data) return null;
    const item = mapQueue(data);
    if (item.bagStatus !== "UNDER_RECHECK") return null;
    const [recalls, actions] = await Promise.all([
      getSupabaseAdminClient()
        .from("hbss_recall_requests")
        .select(
          "id,status,adapter_type,requested_at,completed_at,error_code,error_message,response_metadata",
        )
        .eq("bag_id", bagId)
        .order("requested_at", { ascending: false }),
      getSupabaseAdminClient()
        .from("alarm_actions")
        .select("id,action,reason,notes,created_at")
        .eq("alarm_id", item.alarmId)
        .order("created_at", { ascending: true }),
    ]);
    if (recalls.error || actions.error)
      throw new RecheckServiceError(
        "Unable to load Recheck history",
        "RECHECK_PROCESSING_FAILED",
        500,
        { cause: recalls.error ?? actions.error },
      );
    const latest = (recalls.data ?? [])[0];
    return {
      bag: {
        id: item.bagId,
        bhsUid: item.bhsUid,
        rfidTagBarcode: item.rfidTagBarcode,
        epc: item.epc,
        screeningEvaluation: item.screeningEvaluation,
        status: "AT_RECHECK",
        version: item.bagVersion,
      },
      alarm: {
        id: item.alarmId,
        status: item.alarmStatus,
        severity: item.alarmSeverity,
        version: item.alarmVersion,
        openedAt: text(asRow(data).opened_at) ?? "",
        sentToRecheckAt: item.sentToRecheckAt,
      },
      lookup: { method },
      recall: {
        latestStatus: latest ? mapRecall(latest).status : null,
        latestRequestedAt: latest ? mapRecall(latest).requestedAt : null,
      },
      actions: mapActions(actions.data ?? []),
    } satisfies RecheckCase;
  },
  async findByTag(tag: string) {
    const normalized = tag.trim().toUpperCase();
    let { data, error } = await getSupabaseAdminClient()
      .from("bags")
      .select("id")
      .eq("rfid_tag_barcode", normalized)
      .maybeSingle();
    if (error)
      throw new RecheckServiceError("Unable to scan RFID label", "RECHECK_PROCESSING_FAILED", 500, {
        cause: error,
      });
    if (data) return this.caseForBag(String(asRow(data).id), "RFID_TAG_BARCODE");
    ({ data, error } = await getSupabaseAdminClient()
      .from("bags")
      .select("id")
      .eq("epc", normalized)
      .maybeSingle());
    if (error)
      throw new RecheckServiceError("Unable to scan RFID EPC", "RECHECK_PROCESSING_FAILED", 500, {
        cause: error,
      });
    return data ? this.caseForBag(String(asRow(data).id), "EPC") : null;
  },
  async recalls(bagId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("hbss_recall_requests")
      .select(
        "id,status,adapter_type,requested_at,completed_at,error_code,error_message,response_metadata",
      )
      .eq("bag_id", bagId)
      .order("requested_at", { ascending: false });
    if (error)
      throw new RecheckServiceError(
        "Unable to load HBSS recall history",
        "RECHECK_PROCESSING_FAILED",
        500,
        { cause: error },
      );
    return (data ?? []).map(mapRecall);
  },
  async beginRecall(input: Record<string, unknown>) {
    const { data, error } = await getSupabaseAdminClient().rpc(
      "begin_beltcon_hbss_recall_v1",
      input,
    );
    if (error)
      throw new RecheckServiceError(
        "Unable to start HBSS recall",
        "RECHECK_PROCESSING_FAILED",
        500,
        { cause: error },
      );
    return asRow(data);
  },
  async completeRecall(input: Record<string, unknown>) {
    const { data, error } = await getSupabaseAdminClient().rpc(
      "complete_beltcon_hbss_recall_v1",
      input,
    );
    if (error)
      throw new RecheckServiceError(
        "Unable to complete HBSS recall",
        "RECHECK_PROCESSING_FAILED",
        500,
        { cause: error },
      );
    return asRow(data);
  },
  async resolve(input: Record<string, unknown>) {
    const { data, error } = await getSupabaseAdminClient().rpc(
      "resolve_beltcon_recheck_case_v1",
      input,
    );
    if (error)
      throw new RecheckServiceError(
        "Unable to resolve Recheck case",
        "RECHECK_PROCESSING_FAILED",
        500,
        { cause: error },
      );
    return asRow(data);
  },
};
export type RecheckRepository = typeof recheckRepository;
