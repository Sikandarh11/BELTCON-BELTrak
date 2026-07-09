import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { alarmService } from "@/services/alarmService";
import { useState } from "react";
import { Eye, Check, ArrowUpRight, X } from "lucide-react";
import { useSession } from "@/auth/SessionContext";
import { toast } from "sonner";

export const Route = createFileRoute("/alarms")({
  head: () => ({ meta: [{ title: "Notifications & Alarms · BELTrak" }] }),
  component: Alarms,
});

function Alarms() {
  const session = useSession();
  const alarms = useAppStore((s) => s.alarms);
  const bags = useAppStore((s) => s.bags);
  const navigate = useNavigate();

  const [statusFilters, setStatusFilters] = useState<Set<string>>(
    new Set(["OPEN", "UNDER_INVESTIGATION", "ESCALATED"])
  );
  const [flightFilter, setFlightFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("all");

  const allZones = [...new Set(alarms.map((a) => a.zone))];

  const filteredAlarms = alarms.filter((a) => {
    const statusMatch = statusFilters.has(a.outcome) ||
      (statusFilters.has("CLOSED") && !["OPEN", "UNDER_INVESTIGATION", "ESCALATED"].includes(a.outcome));
    const flightMatch = !flightFilter ||
      (bags.find((b) => b.id === a.bagId)?.flight?.toLowerCase().includes(flightFilter.toLowerCase()));
    const zoneMatch = zoneFilter === "all" || a.zone === zoneFilter;
    return statusMatch && flightMatch && zoneMatch;
  });

  const active = alarms.filter((a) => a.outcome === "OPEN").length;
  const escalated = alarms.filter((a) => a.outcome === "ESCALATED").length;
  const acked = alarms.filter((a) => a.outcome === "UNDER_INVESTIGATION").length;
  const closed = alarms.filter((a) =>
    !["OPEN", "UNDER_INVESTIGATION", "ESCALATED"].includes(a.outcome)
  ).length;

  const outcomeToStatus = (o: string) =>
    o === "OPEN" ? "ACTIVE"
      : o === "UNDER_INVESTIGATION" ? "ACKNOWLEDGED"
      : o === "ESCALATED" ? "ESCALATED"
      : "CLOSED";

  return (
    <div className="p-6">
      <PageHeader
        title="Notifications & Alarms"
        subtitle="Manage and triage active customs alarms across all RFID portals."
      />
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { l: "Active", v: active, c: "text-danger", b: "border-danger/30 bg-danger/5" },
          { l: "Escalated", v: escalated, c: "text-warning", b: "border-warning/30 bg-warning/5" },
          { l: "Acknowledged", v: acked, c: "text-info", b: "border-info/30 bg-info/5" },
          { l: "Closed today", v: closed, c: "text-muted-foreground", b: "border-border" },
        ].map((s) => (
          <div key={s.l} className={`rounded-lg border p-3 ${s.b}`}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
            <div className={`text-2xl font-semibold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {alarms.length === 0 && (
        <div className="py-12 text-center text-[13px] text-muted-foreground">
          No alarms recorded — use the Simulator to trigger one
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Filter" className="col-span-12 lg:col-span-3">
          <div className="space-y-3 text-[12px]">
            <div>
              <div className="text-muted-foreground mb-1.5">Status</div>
              {[
                { label: "Active", value: "OPEN" },
                { label: "Escalated", value: "ESCALATED" },
                { label: "Acknowledged", value: "UNDER_INVESTIGATION" },
                { label: "Closed", value: "CLOSED" },
              ].map((s) => (
                <label key={s.value} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={statusFilters.has(s.value)}
                    onChange={(e) => {
                      const next = new Set(statusFilters);
                      e.target.checked ? next.add(s.value) : next.delete(s.value);
                      setStatusFilters(next);
                    }}
                    className="accent-primary"
                  /> {s.label}
                </label>
              ))}
            </div>
            <div>
              <div className="text-muted-foreground mb-1.5">Flight</div>
              <input
                placeholder="e.g. SV452"
                value={flightFilter}
                onChange={(e) => setFlightFilter(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1.5"
              />
            </div>
            <div>
              <div className="text-muted-foreground mb-1.5">Location</div>
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1.5"
              >
                <option value="all">All locations</option>
                {allZones.map((z) => (
                  <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                setStatusFilters(new Set(["OPEN", "UNDER_INVESTIGATION", "ESCALATED"]));
                setFlightFilter("");
                setZoneFilter("all");
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-md border border-border hover:bg-accent text-[12px]"
            >
              Clear filters
            </button>
          </div>
        </Panel>

        <Panel className="col-span-12 lg:col-span-9 !p-0">
          <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border">
            Showing {filteredAlarms.length} of {alarms.length} alarms
          </div>
          <table className="w-full text-[12.5px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-background/40 border-b border-border">
              <tr>
                {["Alarm ID","Time","Tag ID","Flight","Reader Location","Threat Type","Status","Officer","Actions"].map(h => (
                  <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAlarms.map((a) => (
                <tr key={a.id} className="border-b border-border hover:bg-accent/30">
                  <td className="px-3 py-2.5 font-mono text-primary">{a.id}</td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{new Date(a.triggeredAt).toLocaleTimeString()}</td>
                  <td className="px-3 py-2.5 font-mono">{bags.find((b) => b.id === a.bagId)?.iataCode ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono">{bags.find((b) => b.id === a.bagId)?.flight ?? "—"}</td>
                  <td className="px-3 py-2.5">{a.zone.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2.5">Suspect Bag</td>
                  <td className="px-3 py-2.5"><StatusPill status={outcomeToStatus(a.outcome)} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{a.acknowledgedBy ?? "Unassigned"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button title="View" onClick={() => navigate({ to: "/target", search: { bagId: a.bagId } })} className="size-7 inline-flex items-center justify-center rounded hover:bg-accent"><Eye className="size-3.5" /></button>
                      <button title="Acknowledge" onClick={() => {
                        try { alarmService.acknowledge(a.id, `${session.firstName} ${session.lastName}`); }
                        catch (err: any) { toast.error(err.message || "Action failed"); }
                      }} className="size-7 inline-flex items-center justify-center rounded hover:bg-accent text-info"><Check className="size-3.5" /></button>
                      <button title="Escalate" onClick={() => {
                        try { alarmService.escalate(a.id); }
                        catch (err: any) { toast.error(err.message || "Action failed"); }
                      }} className="size-7 inline-flex items-center justify-center rounded hover:bg-accent text-warning"><ArrowUpRight className="size-3.5" /></button>
                      <button title="Close" onClick={() => {
                        try { alarmService.resolve(a.id, "CLEARED", session.id); }
                        catch (err: any) { toast.error(err.message || "Action failed"); }
                      }} className="size-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"><X className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
