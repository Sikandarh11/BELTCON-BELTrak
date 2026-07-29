import "@tanstack/react-start/server-only";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";

import { readerRepository } from "@/services/readers/readerRepository.server";

import type { OperationalReport, ReportFilters, ReportType } from "./reportSchemas";

type Row = Record<string, unknown>;
const MAX_REPORT_ROWS = 25_000;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}
function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
function moment(value: unknown) {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function within(value: string | null, filters: ReportFilters) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return (
    (!filters.dateFrom || timestamp >= Date.parse(filters.dateFrom)) &&
    (!filters.dateTo || timestamp <= Date.parse(filters.dateTo))
  );
}
function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : 0;
}
function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.floor((sorted.length - 1) / 2)]);
}
function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]);
}
function countBy(values: Row[], field: string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = text(value[field]) ?? "Not available";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, value]) => ({ label, value }));
}
function dailySeries(values: Row[], field: string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const timestamp = moment(value[field]);
    if (!timestamp) continue;
    const day = timestamp.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([timestamp, value]) => ({ timestamp, value }));
}

async function boundedRows(
  table: string,
  select: string,
  timestampColumn: string,
  filters: ReportFilters,
) {
  let query = getSupabaseAdminClient()
    .from(table)
    .select(select)
    .order(timestampColumn, { ascending: false })
    .limit(MAX_REPORT_ROWS + 1);
  if (filters.dateFrom) query = query.gte(timestampColumn, filters.dateFrom);
  if (filters.dateTo) query = query.lte(timestampColumn, filters.dateTo);
  const { data, error } = await query;
  if (error) throw new Error(`Unable to load ${table} reporting data`, { cause: error });
  return {
    rows: (data ?? []).slice(0, MAX_REPORT_ROWS).map(row),
    truncated: (data?.length ?? 0) > MAX_REPORT_ROWS,
  };
}

function limitations(...truncated: boolean[]) {
  return truncated.some(Boolean)
    ? ["The selected range exceeded a bounded operational reporting query limit."]
    : [];
}

function bagFilter(value: Row, filters: ReportFilters) {
  return (
    (!filters.bhsLineId || value.bhs_line_id === filters.bhsLineId) &&
    (!filters.screeningEvaluation || value.screening_evaluation === filters.screeningEvaluation) &&
    (!filters.bagStatus || value.status === filters.bagStatus) &&
    (!filters.zone || value.current_zone === filters.zone)
  );
}

export interface OperationalReportRepository {
  generate(
    reportType: ReportType,
    filters: ReportFilters,
    requestId: string,
  ): Promise<OperationalReport>;
}

export const operationalReportRepository: OperationalReportRepository = {
  async generate(reportType, filters, requestId): Promise<OperationalReport> {
    const generatedAt = new Date().toISOString();
    if (reportType === "bag-lifecycle" || reportType === "tagging") {
      const { rows, truncated } = await boundedRows(
        "bags",
        "id,status,created_at,flagged_at,tagged_at,updated_at,bhs_line_id,screening_evaluation,current_zone,epc,rfid_tag_barcode",
        "created_at",
        filters,
      );
      const bags = rows.filter((value) => bagFilter(value, filters));
      const tagDurations = bags.flatMap((bag) => {
        const start = moment(bag.created_at) ?? moment(bag.flagged_at);
        const end = moment(bag.tagged_at);
        return start && end ? [(Date.parse(end) - Date.parse(start)) / 1000] : [];
      });
      if (reportType === "tagging") {
        const { rows: auditRows, truncated: auditTruncated } = await boundedRows(
          "audit_events",
          "action,outcome,created_at,metadata",
          "created_at",
          filters,
        );
        const rejects = auditRows.filter(
          (event) => text(event.action)?.includes("TAG") && text(event.outcome) === "REJECTED",
        );
        return {
          requestId,
          reportType,
          filters,
          summary: {
            eligibleBagsReceived: bags.length,
            tagsAssigned: bags.filter((bag) => Boolean(text(bag.epc))).length,
            pendingTagging: bags.filter((bag) => bag.status === "IDENTIFIED").length,
            tagAssignmentFailures: rejects.length,
            duplicateEpcAttempts: rejects.filter((event) =>
              JSON.stringify(event.metadata).includes("DUPLICATE_EPC"),
            ).length,
            duplicateBarcodeAttempts: rejects.filter((event) =>
              JSON.stringify(event.metadata).includes("DUPLICATE_BARCODE"),
            ).length,
            medianTagAssignmentSeconds: median(tagDurations),
            p90TagAssignmentSeconds: percentile(tagDurations, 0.9),
          },
          series: dailySeries(
            bags.filter((bag) => Boolean(text(bag.epc))),
            "tagged_at",
          ),
          breakdowns: {
            byBhsLine: countBy(bags, "bhs_line_id"),
            byScreeningEvaluation: countBy(bags, "screening_evaluation"),
          },
          generatedAt,
          dataLimitations: limitations(truncated, auditTruncated),
        };
      }
      return {
        requestId,
        reportType,
        filters,
        summary: {
          totalEligibleBhsMessages: bags.length,
          awaitingTagging: bags.filter((bag) => bag.status === "IDENTIFIED").length,
          tagged: bags.filter((bag) =>
            ["TAGGED", "IN_ARRIVAL_HALL", "ALARMED", "UNDER_RECHECK", "RESOLVED"].includes(
              String(bag.status),
            ),
          ).length,
          detectedAtReclaim: bags.filter((bag) => bag.current_zone === "RECLAIM").length,
          detectedAtCustomsExit: bags.filter((bag) => bag.current_zone === "CUSTOMS_EXIT").length,
          activeAlarms: bags.filter((bag) => bag.status === "ALARMED").length,
          atRecheck: bags.filter((bag) => bag.status === "UNDER_RECHECK").length,
          resolved: bags.filter((bag) => bag.status === "RESOLVED").length,
          averageBhsToTagSeconds: average(tagDurations),
        },
        series: dailySeries(bags, "created_at"),
        breakdowns: {
          byStatus: countBy(bags, "status"),
          byScreeningEvaluation: countBy(bags, "screening_evaluation"),
        },
        generatedAt,
        dataLimitations: limitations(truncated),
      };
    }

    if (reportType === "rfid") {
      const { rows, truncated } = await boundedRows(
        "rfid_events",
        "id,epc,reader_id,antenna_id,zone_code,server_received_at,processing_status,processing_outcome",
        "server_received_at",
        filters,
      );
      const events = rows.filter(
        (event) =>
          (!filters.readerId || event.reader_id === filters.readerId) &&
          (!filters.zone || event.zone_code === filters.zone),
      );
      return {
        requestId,
        reportType,
        filters,
        summary: {
          totalAcceptedEvents: events.filter((event) => event.processing_status === "ACCEPTED")
            .length,
          uniqueEpcs: new Set(events.map((event) => text(event.epc)).filter(Boolean)).size,
          assignedEpcEvents: events.filter((event) => event.processing_outcome !== "UNASSIGNED_EPC")
            .length,
          unassignedEpcEvents: events.filter(
            (event) => event.processing_outcome === "UNASSIGNED_EPC",
          ).length,
          reclaimDetections: events.filter((event) => event.zone_code === "RECLAIM").length,
          customsExitDetections: events.filter((event) => event.zone_code === "CUSTOMS_EXIT")
            .length,
          processingFailures: events.filter((event) => event.processing_status === "FAILED").length,
        },
        series: dailySeries(events, "server_received_at"),
        breakdowns: {
          byReader: countBy(events, "reader_id"),
          byZone: countBy(events, "zone_code"),
        },
        generatedAt,
        dataLimitations: limitations(truncated),
      };
    }

    if (reportType === "alarms") {
      const { rows, truncated } = await boundedRows(
        "alarms",
        "id,outcome,severity,opened_at,acknowledged_at,escalated_at,sent_to_recheck_at,closed_at,zone_code,source_rfid_event_id",
        "opened_at",
        filters,
      );
      const alarms = rows.filter(
        (alarm) =>
          (!filters.alarmStatus || alarm.outcome === filters.alarmStatus) &&
          (!filters.alarmSeverity || alarm.severity === filters.alarmSeverity) &&
          (!filters.zone || alarm.zone_code === filters.zone),
      );
      const { rows: auditRows, truncated: auditTruncated } = await boundedRows(
        "audit_events",
        "action,created_at",
        "created_at",
        filters,
      );
      return {
        requestId,
        reportType,
        filters,
        summary: {
          alarmsOpened: alarms.length,
          activeAlarms: alarms.filter(
            (alarm) => !["CLOSED", "CLEARED", "NOT_CLEARED"].includes(String(alarm.outcome)),
          ).length,
          acknowledged: alarms.filter((alarm) => Boolean(moment(alarm.acknowledged_at))).length,
          escalated: alarms.filter((alarm) => Boolean(moment(alarm.escalated_at))).length,
          sentToRecheck: alarms.filter((alarm) => Boolean(moment(alarm.sent_to_recheck_at))).length,
          closed: alarms.filter((alarm) => Boolean(moment(alarm.closed_at))).length,
          existingActiveAlarmReused: auditRows.filter(
            (event) => event.action === "CUSTOMS_EXIT_ALARM_ALREADY_ACTIVE",
          ).length,
        },
        series: dailySeries(alarms, "opened_at"),
        breakdowns: { byStatus: countBy(alarms, "outcome"), byZone: countBy(alarms, "zone_code") },
        generatedAt,
        dataLimitations: limitations(truncated, auditTruncated),
      };
    }

    if (reportType === "recheck") {
      const [recallsResult, resolutionsResult] = await Promise.all([
        boundedRows(
          "hbss_recall_requests",
          "id,status,adapter_type,requested_at,completed_at,bag_id",
          "requested_at",
          filters,
        ),
        boundedRows("resolutions", "id,action,resolved_at,bag_id", "resolved_at", filters),
      ]);
      const recalls = recallsResult.rows;
      const resolutions = resolutionsResult.rows.filter(
        (resolution) =>
          !filters.resolutionDisposition || resolution.action === filters.resolutionDisposition,
      );
      return {
        requestId,
        reportType,
        filters,
        summary: {
          hbssRecallAttempts: recalls.length,
          simulatedRecalls: recalls.filter((recall) => recall.status === "SIMULATED").length,
          failedRecalls: recalls.filter((recall) => recall.status === "FAILED").length,
          unavailableRecalls: recalls.filter((recall) => recall.status === "UNAVAILABLE").length,
          resolvedCases: resolutions.length,
          cleared: resolutions.filter((resolution) => resolution.action === "CLEARED").length,
          notCleared: resolutions.filter((resolution) => resolution.action === "NOT_CLEARED")
            .length,
        },
        series: dailySeries(resolutions, "resolved_at"),
        breakdowns: {
          recallStatus: countBy(recalls, "status"),
          dispositions: countBy(resolutions, "action"),
        },
        generatedAt,
        dataLimitations: [
          "HBSS adapter results are labeled from stored adapter status and may be simulated.",
          ...limitations(recallsResult.truncated, resolutionsResult.truncated),
        ],
      };
    }

    if (reportType === "readers") {
      const readers = await readerRepository.list({
        page: 1,
        pageSize: 100,
        sort: "readerCode",
        direction: "asc",
        ...(filters.zone ? { zone: filters.zone } : {}),
      });
      return {
        requestId,
        reportType,
        filters,
        summary: {
          totalConfiguredReaders: readers.total,
          enabledReaders: readers.items.filter((reader) => reader.enabled).length,
          online: readers.items.filter((reader) => reader.calculatedHealth === "ONLINE").length,
          degraded: readers.items.filter((reader) => reader.calculatedHealth === "DEGRADED").length,
          offline: readers.items.filter((reader) => reader.calculatedHealth === "OFFLINE").length,
          disabled: readers.items.filter((reader) => reader.calculatedHealth === "DISABLED").length,
          unknown: readers.items.filter((reader) => reader.calculatedHealth === "UNKNOWN").length,
          unmappedAntennas: readers.items.filter((reader) => reader.antennaCount === 0).length,
          disabledAntennas: readers.items.reduce(
            (total, reader) => total + reader.antennaCount - reader.activeAntennaCount,
            0,
          ),
        },
        series: [],
        breakdowns: {
          byHealth: readers.items.map((reader) => ({
            reader: reader.readerCode,
            health: reader.calculatedHealth,
            lastSeenAt: reader.lastSeenAt,
          })),
        },
        generatedAt,
        dataLimitations: readers.dataLimitations,
      };
    }

    const [screeningResult, rfidResult, recallResult] = await Promise.all([
      boundedRows(
        "screening_integration_events",
        "id,source_system,processing_status,screening_evaluation,received_at",
        "received_at",
        filters,
      ),
      boundedRows(
        "rfid_events",
        "id,source_system,processing_status,processing_outcome,server_received_at",
        "server_received_at",
        filters,
      ),
      boundedRows(
        "hbss_recall_requests",
        "id,status,adapter_type,requested_at",
        "requested_at",
        filters,
      ),
    ]);
    const bhs = screeningResult.rows.filter(
      (event) => !filters.integrationSource || event.source_system === filters.integrationSource,
    );
    const rfid = rfidResult.rows.filter(
      (event) => !filters.integrationSource || event.source_system === filters.integrationSource,
    );
    return {
      requestId,
      reportType,
      filters,
      summary: {
        bhsMessagesReceived: bhs.length,
        bhsAccepted: bhs.filter((event) => event.processing_status === "ACCEPTED").length,
        bhsDuplicates: bhs.filter((event) => event.processing_status === "DUPLICATE").length,
        bhsFailed: bhs.filter((event) => event.processing_status === "FAILED").length,
        rfidReadsReceived: rfid.length,
        rfidProcessed: rfid.filter((event) => event.processing_status === "ACCEPTED").length,
        rfidDuplicates: rfid.filter((event) => event.processing_status === "DUPLICATE").length,
        rfidUnassignedEpcs: rfid.filter((event) => event.processing_outcome === "UNASSIGNED_EPC")
          .length,
        hbssRecallRequested: recallResult.rows.length,
        hbssSimulated: recallResult.rows.filter((event) => event.status === "SIMULATED").length,
        hbssFailed: recallResult.rows.filter((event) => event.status === "FAILED").length,
      },
      series: dailySeries(bhs, "received_at"),
      breakdowns: {
        bhsByStatus: countBy(bhs, "processing_status"),
        rfidByStatus: countBy(rfid, "processing_status"),
        hbssByStatus: countBy(recallResult.rows, "status"),
      },
      generatedAt,
      dataLimitations: [
        "HBSS outcomes report stored adapter status; physical adapter transport is deferred.",
        ...limitations(screeningResult.truncated, rfidResult.truncated, recallResult.truncated),
      ],
    };
  },
};
