import { createFileRoute } from "@tanstack/react-router";
import { Download, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { useSession } from "@/auth/SessionContext";
import { PageHeader, Panel } from "@/components/AppLayout";
import { useOperationalReport } from "@/services/reports/operationalReportClient";
import type {
  OperationalReport,
  ReportFilters,
  ReportType,
} from "@/services/reports/reportSchemas";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "BELTCON Operational Reports · BELTCON SBTS" }] }),
  component: Reports,
});

const REPORT_OPTIONS: Array<{ value: ReportType; label: string }> = [
  { value: "bag-lifecycle", label: "Bag Lifecycle Summary" },
  { value: "tagging", label: "Tagging Performance" },
  { value: "rfid", label: "RFID Detection Activity" },
  { value: "alarms", label: "Customs Exit Alarm Summary" },
  { value: "recheck", label: "Recheck Outcome Summary" },
  { value: "readers", label: "Reader Health Summary" },
  { value: "integrations", label: "Integration Processing Summary" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}
function initialFilters(): ReportFilters {
  return {
    dateFrom: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dateTo: today(),
  };
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load report";
}
function reportUrl(reportType: ReportType, filters: ReportFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
  return `/api/reports/${reportType}/export/csv?${query.toString()}`;
}

function ReportData({ reportType, filters }: { reportType: ReportType; filters: ReportFilters }) {
  return <ReportDataView query={useOperationalReport(reportType, filters)} />;
}

function ReportDataView({
  query,
}: {
  query: {
    data?: OperationalReport;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => Promise<unknown>;
  };
}) {
  const trend = useMemo(
    () => query.data?.series.map((point) => ({ ...point, label: point.timestamp.slice(5) })) ?? [],
    [query.data?.series],
  );
  if (query.isLoading)
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded bg-muted" />
        <div className="h-56 animate-pulse rounded bg-muted" />
      </div>
    );
  if (query.isError)
    return (
      <div className="py-16 text-center text-sm">
        <p role="alert" className="text-danger">
          {errorMessage(query.error)}
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-3 rounded border border-border px-3 py-2"
        >
          Retry
        </button>
      </div>
    );
  const report = query.data;
  if (!report) return null;
  return (
    <div className="space-y-4">
      {report.dataLimitations.map((limitation) => (
        <p
          key={limitation}
          className="rounded border border-warning/30 bg-warning/5 p-2 text-xs text-warning"
        >
          {limitation}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(report.summary).map(([label, value]) => (
          <div key={label} className="rounded border border-border bg-card p-3">
            <div className="text-xl font-semibold">{value}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {label.replace(/([A-Z])/g, " $1")}
            </div>
          </div>
        ))}
      </div>
      <Panel title="Trend">
        <div className="flex min-h-36 items-end gap-1 overflow-x-auto pt-5">
          {trend.length === 0 ? (
            <p className="self-center text-sm text-muted-foreground">
              No records exist for the selected range.
            </p>
          ) : (
            trend.map((point) => (
              <div
                key={point.timestamp}
                className="flex min-w-8 flex-1 flex-col items-center gap-1 text-[10px] text-muted-foreground"
              >
                <span>{point.value}</span>
                <div
                  title={`${point.timestamp}: ${point.value}`}
                  className="w-full min-h-1 rounded-t bg-primary"
                  style={{ height: `${Math.max(4, Math.min(120, point.value * 8))}px` }}
                />
                <span>{point.label}</span>
              </div>
            ))
          )}
        </div>
      </Panel>
      {Object.entries(report.breakdowns).map(([name, rows]) => (
        <Panel key={name} title={name.replace(/([A-Z])/g, " $1")} className="!p-0">
          <div className="overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {Object.keys(rows[0] ?? {}).map((column) => (
                    <th key={column} className="px-3 py-2 font-medium">
                      {column.replace(/([A-Z])/g, " $1")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground">No records.</td>
                  </tr>
                ) : (
                  rows.map((item, index) => (
                    <tr key={`${name}-${index}`} className="border-t border-border">
                      {Object.entries(item).map(([column, value]) => (
                        <td key={column} className="px-3 py-2">
                          {value ?? "Not available"}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Reports() {
  const session = useSession();
  const [reportType, setReportType] = useState<ReportType>("bag-lifecycle");
  const [draft, setDraft] = useState<ReportFilters>(initialFilters);
  const [applied, setApplied] = useState<ReportFilters>(initialFilters);
  const [invalidRange, setInvalidRange] = useState<string | null>(null);
  if (!session.permissions.includes("report.view"))
    return (
      <div className="p-6">
        <PageHeader
          title="BELTCON Operational Reports"
          subtitle="Server-aggregated operational reports"
        />
        <p role="alert" className="rounded border border-danger/30 p-4 text-sm text-danger">
          Permission report.view is required.
        </p>
      </div>
    );
  const apply = () => {
    if (
      draft.dateFrom &&
      draft.dateTo &&
      Date.parse(draft.dateTo) - Date.parse(draft.dateFrom) > 90 * 24 * 60 * 60 * 1000
    ) {
      setInvalidRange("The maximum interactive report range is 90 days.");
      return;
    }
    if (draft.dateFrom && draft.dateTo && Date.parse(draft.dateTo) < Date.parse(draft.dateFrom)) {
      setInvalidRange("Date from must be before date to.");
      return;
    }
    setInvalidRange(null);
    setApplied({ ...draft });
  };
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Operational Reports"
        subtitle="Authoritative server aggregation for SBTS Baseline V1."
        actions={
          <a
            href={reportUrl(reportType, applied)}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm"
          >
            <Download className="size-4" />
            Export CSV
          </a>
        }
      />
      <Panel title="Report filters" className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs">
            Report
            <select
              value={reportType}
              onChange={(event) => setReportType(event.target.value as ReportType)}
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              {REPORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Date from
            <input
              type="date"
              value={draft.dateFrom ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, dateFrom: event.target.value || undefined }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Date to
            <input
              type="date"
              value={draft.dateTo ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, dateTo: event.target.value || undefined }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Zone
            <select
              value={draft.zone ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  zone: (event.target.value as ReportFilters["zone"]) || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              <option value="">All zones</option>
              {[
                "TAGGING",
                "RECLAIM",
                "CUSTOMS_EXIT",
                "RECHECK",
                "WASHROOM",
                "EMPLOYEE_EXIT",
                "EMERGENCY_EXIT",
                "LOST_AND_FOUND",
                "CORRIDOR",
                "OTHER",
              ].map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs">
            BHS line ID
            <input
              value={draft.bhsLineId ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, bhsLineId: event.target.value || undefined }))
              }
              maxLength={2}
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Screening evaluation
            <select
              value={draft.screeningEvaluation ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  screeningEvaluation:
                    (event.target.value as ReportFilters["screeningEvaluation"]) || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              <option value="">All evaluations</option>
              {["ACCEPT", "REJECT", "TIMEOUT", "NO_DECISION", "MISTRACK"].map((evaluation) => (
                <option key={evaluation}>{evaluation}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Bag status
            <input
              value={draft.bagStatus ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, bagStatus: event.target.value || undefined }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Reader ID
            <input
              value={draft.readerId ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, readerId: event.target.value || undefined }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Alarm status
            <input
              value={draft.alarmStatus ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  alarmStatus: event.target.value || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs">
            Alarm severity
            <select
              value={draft.alarmSeverity ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  alarmSeverity:
                    (event.target.value as ReportFilters["alarmSeverity"]) || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              <option value="">All severities</option>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((severity) => (
                <option key={severity}>{severity}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Resolution
            <select
              value={draft.resolutionDisposition ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  resolutionDisposition:
                    (event.target.value as ReportFilters["resolutionDisposition"]) || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              <option value="">All dispositions</option>
              <option value="CLEARED">Cleared</option>
              <option value="NOT_CLEARED">Not cleared</option>
            </select>
          </label>
          <label className="text-xs">
            Integration source
            <input
              value={draft.integrationSource ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  integrationSource: event.target.value || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={apply}
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              const reset = initialFilters();
              setDraft(reset);
              setApplied(reset);
              setInvalidRange(null);
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm"
          >
            <RefreshCw className="size-4" />
            Reset
          </button>
        </div>
        {invalidRange ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {invalidRange}
          </p>
        ) : null}
      </Panel>
      <ReportData reportType={reportType} filters={applied} />
    </div>
  );
}
