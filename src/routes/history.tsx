import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { Search, Download, Tag, ScanLine, AlertTriangle, BellRing } from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Query Tag History · BELTrak" }] }),
  component: History,
});

function History() {
  const events = useAppStore((s) => s.events);

  const timeline = events
    .slice()
    .sort((a, b) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime())
    .map((e) => ({
      time: new Date(e.firstSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      event: e.eventType === "TAG_ENCODED" ? "Tagged at Station"
           : e.eventType === "ALARM_TRIGGERED" ? "Alarm raised"
           : e.eventType === "CUSTOMS_EXIT_DETECTED" ? "Detected at Exit Gate"
           : `Read at ${e.zone.replace(/_/g, " ")}`,
      loc: `${e.readerId} / ${e.zone.replace(/_/g, " ")}`,
      icon: e.eventType === "TAG_ENCODED" ? "tag"
          : e.eventType.includes("ALARM") || e.eventType.includes("EXIT") ? "alarm"
          : "scan",
    }));

  return (
    <div className="p-6">
      <PageHeader
        title="Query Tag History"
        subtitle="Trace the full lifecycle of any tagged bag across the facility."
        actions={
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent">
            <Download className="size-3.5" /> Export CSV
          </button>
        }
      />

      <Panel title="Search" className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-[12px]">
          <div>
            <div className="text-muted-foreground mb-1">Tag ID</div>
            <input defaultValue="ETB-240091" className="w-full bg-background border border-border rounded px-2.5 py-1.5 font-mono" />
          </div>
          <div>
            <div className="text-muted-foreground mb-1">Flight Number</div>
            <input defaultValue="SV452" className="w-full bg-background border border-border rounded px-2.5 py-1.5 font-mono" />
          </div>
          <div>
            <div className="text-muted-foreground mb-1">Passenger Name</div>
            <input defaultValue="Ahmed Al-Harbi" className="w-full bg-background border border-border rounded px-2.5 py-1.5" />
          </div>
          <div>
            <div className="text-muted-foreground mb-1">Date Range</div>
            <input type="date" defaultValue="2026-06-17" className="w-full bg-background border border-border rounded px-2.5 py-1.5" />
          </div>
          <div className="flex items-end">
            <button className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium">
              <Search className="size-3.5" /> Search
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Timeline · ETB-240091" className="col-span-12 lg:col-span-7">
          <ol className="relative pl-6">
            <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
            {timeline.map((e, i) => {
              const Icon = e.icon === "tag" ? Tag : e.icon === "scan" ? ScanLine : e.icon === "alert" ? AlertTriangle : BellRing;
              const color = e.icon === "alarm" ? "bg-danger/15 text-danger border-danger/30" : e.icon === "alert" ? "bg-warning/15 text-warning border-warning/30" : "bg-info/15 text-info border-info/30";
              return (
                <li key={i} className="relative pb-4 last:pb-0">
                  <div className={`absolute size-7 rounded-full border ${color} flex items-center justify-center`} style={{ left: "-18px" }}>
                    <Icon className="size-3.5" />
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <span className="font-mono text-[12px] text-muted-foreground">{e.time}</span>
                    <span className="text-[13px] font-medium">{e.event}</span>
                  </div>
                  <div className="ml-2 text-[11.5px] text-muted-foreground">{e.loc}</div>
                </li>
              );
            })}
          </ol>
        </Panel>

        <Panel title="Read Events · Table" className="col-span-12 lg:col-span-5">
          <table className="w-full text-[12px]">
            <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
              <tr><th className="text-left px-3 py-2">Time</th><th className="text-left px-3 py-2">Reader</th><th className="text-left px-3 py-2">Antenna</th><th className="text-left px-3 py-2">RSSI</th></tr>
            </thead>
            <tbody>
              {[
                ["08:12:04","RDR-T02","A1","-42 dBm"],
                ["08:15:51","RDR-001","A2","-38 dBm"],
                ["08:23:11","RDR-004","A1","-44 dBm"],
                ["08:32:29","RDR-019","A3","-51 dBm"],
                ["08:45:02","RDR-022","A2","-39 dBm"],
                ["09:14:22","RDR-022","A2","-37 dBm"],
              ].map((r,i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/30">
                  {r.map((c,j) => <td key={j} className="px-3 py-2 font-mono">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
