import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";
import { useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings/audit")({
  head: () => ({ meta: [{ title: "Audit Log · BELTrak" }] }),
  component: AuditLog,
});

function AuditLog() {
  const session = useSession();
  const auditLog = useAppStore((s) => s.auditLog);
  const [search, setSearch] = useState("");

  const filtered = search
    ? auditLog.filter((e) =>
        e.action.toLowerCase().includes(search.toLowerCase()) ||
        e.userName.toLowerCase().includes(search.toLowerCase()) ||
        e.detail.toLowerCase().includes(search.toLowerCase())
      )
    : auditLog;

  function exportCsv() {
    const header = "Timestamp,Action,User,Detail\n";
    const rows = auditLog.map((e) =>
      `${e.timestamp},${e.action},${e.userName},"${e.detail}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `beltrak-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${auditLog.length} entries`);
  }

  return (
    <RoleGate userRole={session.role} requiredRole="Airport Administrator" pageName="Audit Log">
      <div className="p-6">
        <PageHeader
          title="Audit Log"
          subtitle={`${auditLog.length} recorded actions · compliance trail`}
          actions={
            <div className="flex gap-2">
              <div className="relative">
                <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  placeholder="Search actions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-background border border-border rounded-md pl-8 pr-3 py-1.5 text-[12px] w-64"
                />
              </div>
              <button onClick={exportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent">
                <Download className="size-3.5" />Export CSV
              </button>
            </div>
          }
        />

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">
            {auditLog.length === 0 ? "No actions recorded yet — use the system to generate entries" : "No matching entries"}
          </div>
        ) : (
          <Panel className="!p-0">
            <table className="w-full text-[12.5px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/40">
                <tr>
                  {["Time", "Action", "User", "Detail"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((e) => (
                  <tr key={e.id} className="border-b border-border hover:bg-accent/30">
                    <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[11px] font-semibold uppercase tracking-wider ${
                        e.action.includes("ALARM_RAISED") || e.action.includes("ESCAPE") ? "text-danger"
                        : e.action.includes("RESOLVED") || e.action.includes("CLEARED") ? "text-success"
                        : e.action.includes("ESCALATED") ? "text-warning"
                        : "text-primary"
                      }`}>
                        {e.action.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">{e.userName}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 100 && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
                Showing 100 of {filtered.length} entries
              </div>
            )}
          </Panel>
        )}
      </div>
    </RoleGate>
  );
}