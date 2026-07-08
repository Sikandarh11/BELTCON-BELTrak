import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { alarmService } from "@/services/alarmService";
import { Eye, Check, ArrowUpRight, X, Filter } from "lucide-react";

export const Route = createFileRoute("/alarms")({
  head: () => ({ meta: [{ title: "Notifications & Alarms · BELTrak" }] }),
  component: Alarms,
});

function Alarms() {
  const alarms = useAppStore((s) => s.alarms);
  const bags = useAppStore((s) => s.bags);

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
              {["Active","Escalated","Acknowledged","Closed"].map((s) => (
                <label key={s} className="flex items-center gap-2 py-1"><input type="checkbox" defaultChecked={s!=="Closed"} className="accent-primary" /> {s}</label>
              ))}
            </div>
            <div>
              <div className="text-muted-foreground mb-1.5">Date range</div>
              <input type="date" defaultValue="2026-06-17" className="w-full bg-background border border-border rounded px-2 py-1.5" />
            </div>
            <div>
              <div className="text-muted-foreground mb-1.5">Flight</div>
              <input placeholder="e.g. SV452" className="w-full bg-background border border-border rounded px-2 py-1.5" />
            </div>
            <div>
              <div className="text-muted-foreground mb-1.5">Location</div>
              <select className="w-full bg-background border border-border rounded px-2 py-1.5">
                <option>All locations</option>
                <option>Customs Exit Gate 1</option>
                <option>Customs Exit Gate 2</option>
                <option>Washroom North</option>
              </select>
            </div>
            <button className="w-full inline-flex items-center justify-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground font-medium"><Filter className="size-3.5" />Apply filters</button>
          </div>
        </Panel>

        <Panel className="col-span-12 lg:col-span-9 !p-0">
          <table className="w-full text-[12.5px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-background/40 border-b border-border">
              <tr>
                {["Alarm ID","Time","Tag ID","Flight","Reader Location","Threat Type","Status","Officer","Actions"].map(h => (
                  <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alarms.map((a) => (
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
                      <button title="View" className="size-7 inline-flex items-center justify-center rounded hover:bg-accent"><Eye className="size-3.5" /></button>
                      <button title="Acknowledge" onClick={() => alarmService.acknowledge(a.id, "Current Officer")} className="size-7 inline-flex items-center justify-center rounded hover:bg-accent text-info"><Check className="size-3.5" /></button>
                      <button title="Escalate" onClick={() => alarmService.escalate(a.id)} className="size-7 inline-flex items-center justify-center rounded hover:bg-accent text-warning"><ArrowUpRight className="size-3.5" /></button>
                      <button title="Close" onClick={() => alarmService.resolve(a.id, "CLEARED", "current-user")} className="size-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"><X className="size-3.5" /></button>
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
