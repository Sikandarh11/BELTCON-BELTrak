import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Download, FileBarChart2 } from "lucide-react";
import { useState } from "react";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader, Panel } from "@/components/AppLayout";
import { MockBadge } from "@/components/MockBadge";
import { useAppStore } from "@/store/appStore";

export const Route = createFileRoute("/audit/logs")({
  head: () => ({ meta: [{ title: "Audit Logs · BELTrak" }] }),
  component: AuditorLogs,
});

const PAGE_SIZE = 50;

function escapeCsv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function AuditorLogs() {
  const auditLog = useAppStore((state) => state.auditLog);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const filteredEntries = auditLog.filter((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    const matchesFrom = !dateFrom || timestamp >= new Date(`${dateFrom}T00:00:00`).getTime();
    const matchesTo = !dateTo || timestamp <= new Date(`${dateTo}T23:59:59.999`).getTime();
    const matchesActor =
      !actor || entry.userName.toLowerCase().includes(actor.trim().toLowerCase());
    const matchesAction =
      !action ||
      entry.action.toLowerCase().includes(action.trim().toLowerCase()) ||
      entry.detail.toLowerCase().includes(action.trim().toLowerCase());
    return matchesFrom && matchesTo && matchesActor && matchesAction;
  });
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleEntries = filteredEntries.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  function exportCsv() {
    const rows = [
      ["Timestamp", "Actor", "Action", "Detail"],
      ...filteredEntries.map((entry) => [
        entry.timestamp,
        entry.userName,
        entry.action,
        entry.detail,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `beltrak-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <RequireWorkspaceMode modes={["Auditor"]}>
      <div className="p-6">
        <PageHeader
          title="Audit Logs"
          subtitle="Read-only review of user, alarm, and baggage activity."
          actions={
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground"
            >
              <Download className="size-3.5" />
              Export CSV
            </button>
          }
        />

        <Panel title="Filters" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-[11px] text-muted-foreground">
              Date from
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Date to
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Actor
              <input
                value={actor}
                onChange={(event) => {
                  setActor(event.target.value);
                  setPage(1);
                }}
                placeholder="Search actor"
                className="mt-1 block w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Action
              <input
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
                placeholder="Search action or detail"
                className="mt-1 block w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground"
              />
            </label>
          </div>
        </Panel>

        <Panel
          title={`${filteredEntries.length} audit entries`}
          action={<MockBadge />}
          className="overflow-hidden"
        >
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-200 text-[12px]">
              <thead className="border-b border-border bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 text-left font-medium">Actor</th>
                  <th className="px-4 py-2.5 text-left font-medium">Action</th>
                  <th className="px-4 py-2.5 text-left font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{entry.userName}</td>
                    <td className="px-4 py-3 font-mono text-primary">{entry.action}</td>
                    <td className="max-w-md px-4 py-3 text-muted-foreground">{entry.detail}</td>
                  </tr>
                ))}
                {visibleEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                      No audit entries match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="-mx-4 -mb-4 mt-4 flex items-center justify-between border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
            <span>
              Page {currentPage} of {pageCount}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="inline-flex size-8 items-center justify-center rounded-md border border-border disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                disabled={currentPage === pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                className="inline-flex size-8 items-center justify-center rounded-md border border-border disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </Panel>

        <Link
          to="/reports"
          className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-panel/60 p-4 transition hover:border-primary/40 hover:bg-primary/5"
        >
          <div className="flex size-10 items-center justify-center rounded-md bg-primary/10">
            <FileBarChart2 className="size-5 text-primary" />
          </div>
          <span>
            <span className="block text-[13px] font-semibold">Read-only reports</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Open the existing reporting workspace for operational summaries.
            </span>
          </span>
        </Link>
      </div>
    </RequireWorkspaceMode>
  );
}
