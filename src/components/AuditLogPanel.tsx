import { ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { useSession } from "@/auth/SessionContext";
import { Panel, StatusPill } from "@/components/AppLayout";
import { useAuditEvent, useAuditEvents } from "@/services/audit/auditClient";
import type { AuditFilters } from "@/services/audit/auditSchemas";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load audit events";
}
function csvUrl(filters: AuditFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  return `/api/audit/events/export/csv?${query.toString()}`;
}
function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function AuditLogPanel() {
  const session = useSession();
  const [filters, setFilters] = useState<AuditFilters>({ page: 1, pageSize: 25 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQuery = useAuditEvents(filters);
  const detailQuery = useAuditEvent(selectedId);
  const totalPages = Math.max(1, listQuery.data?.totalPages ?? 1);
  const downloadUrl = useMemo(() => csvUrl(filters), [filters]);
  if (!session.permissions.includes("audit.view"))
    return (
      <p role="alert" className="rounded border border-danger/30 p-4 text-sm text-danger">
        Permission audit.view is required.
      </p>
    );
  return (
    <div className="grid grid-cols-12 gap-4">
      <Panel title="Filters" className="col-span-12 lg:col-span-3">
        <div className="space-y-3 text-xs">
          <label className="block">
            Search
            <input
              value={filters.search ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  search: event.target.value || undefined,
                }))
              }
              placeholder="Action, target, request ID"
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block">
            Action
            <input
              value={filters.action ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  action: event.target.value || undefined,
                }))
              }
              placeholder="e.g. BAG_RESOLVED"
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block">
            Outcome
            <input
              value={filters.outcome ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  outcome: event.target.value || undefined,
                }))
              }
              placeholder="SUCCESS"
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block">
            Actor ID
            <input
              value={filters.actorId ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  actorId: event.target.value || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block">
            Target type
            <select
              value={filters.targetType ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  targetType: (event.target.value as AuditFilters["targetType"]) || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              <option value="">All targets</option>
              {["BAG", "XRAY_SCAN", "INTEGRATION_EVENT", "READER", "ALARM", "OTHER"].map(
                (targetType) => (
                  <option key={targetType}>{targetType}</option>
                ),
              )}
            </select>
          </label>
          <label className="block">
            Target ID
            <input
              value={filters.targetId ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  targetId: event.target.value || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block">
            Request ID
            <input
              value={filters.requestId ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  requestId: event.target.value || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block">
            Date from
            <input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  dateFrom: event.target.value || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block">
            Date to
            <input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  dateTo: event.target.value || undefined,
                }))
              }
              className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void listQuery.refetch()}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1.5"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
            <a
              href={downloadUrl}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1.5"
            >
              <Download className="size-3.5" />
              CSV
            </a>
          </div>
          <button
            type="button"
            onClick={() => setFilters({ page: 1, pageSize: 25 })}
            className="rounded border border-border px-2 py-1.5"
          >
            Reset filters
          </button>
        </div>
      </Panel>
      <Panel title="BELTCON Audit Log" className="col-span-12 lg:col-span-5 !p-0">
        {listQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : listQuery.isError ? (
          <div className="p-8 text-center text-sm">
            <p role="alert" className="text-danger">
              {errorMessage(listQuery.error)}
            </p>
            <button
              type="button"
              onClick={() => void listQuery.refetch()}
              className="mt-3 rounded border border-border px-3 py-2"
            >
              Retry
            </button>
          </div>
        ) : listQuery.data?.items.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">
            No durable audit events match the current filters.
          </p>
        ) : (
          <>
            <div className="max-h-[660px] overflow-auto">
              {listQuery.data?.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full border-b border-border p-3 text-left hover:bg-accent/40 ${selectedId === item.id ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium">{item.action.replaceAll("_", " ")}</span>
                    <StatusPill status={item.outcome} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    <span>{date(item.createdAt)}</span>
                    <span>{item.actorDisplayName ?? item.actorId ?? "System"}</span>
                    <span>
                      {item.targetType}
                      {item.targetId ? ` · ${item.targetId}` : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
              <span>
                Page {filters.page} of {totalPages} · {listQuery.data?.total ?? 0} events
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  disabled={filters.page <= 1}
                  onClick={() =>
                    setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                  }
                  className="rounded border border-border p-1 disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={filters.page >= totalPages}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: Math.min(totalPages, current.page + 1),
                    }))
                  }
                  className="rounded border border-border p-1 disabled:opacity-40"
                >
                  <ChevronRight className="size-4" />
                </button>
              </span>
            </div>
          </>
        )}
      </Panel>
      <Panel title="Event detail" className="col-span-12 lg:col-span-4">
        {!selectedId ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Select an audit event to view its safe structured details.
          </p>
        ) : detailQuery.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-7 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : detailQuery.isError ? (
          <div className="text-sm">
            <p role="alert" className="text-danger">
              {errorMessage(detailQuery.error)}
            </p>
            <button
              type="button"
              onClick={() => void detailQuery.refetch()}
              className="mt-3 rounded border border-border px-3 py-2"
            >
              Retry
            </button>
          </div>
        ) : detailQuery.data ? (
          <div className="space-y-3 text-xs">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">Action</dt>
              <dd>{detailQuery.data.action}</dd>
              <dt className="text-muted-foreground">Timestamp</dt>
              <dd>{date(detailQuery.data.createdAt)}</dd>
              <dt className="text-muted-foreground">Actor</dt>
              <dd>{detailQuery.data.actorDisplayName ?? detailQuery.data.actorId ?? "System"}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{detailQuery.data.actorRole ?? "—"}</dd>
              <dt className="text-muted-foreground">Target</dt>
              <dd>
                {detailQuery.data.targetType} {detailQuery.data.targetId ?? "—"}
              </dd>
              <dt className="text-muted-foreground">Request ID</dt>
              <dd className="break-all font-mono">{detailQuery.data.requestId ?? "—"}</dd>
            </dl>
            <div>
              <h3 className="mb-1 font-semibold">Safe metadata</h3>
              <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[11px]">
                {JSON.stringify(detailQuery.data.metadata, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
