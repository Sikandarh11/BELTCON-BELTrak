import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { FileText, FileSpreadsheet, FileDown, Calendar, BarChart3, Users, Radio, AlertTriangle, X } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useAppStore } from "@/store/appStore";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports · BELTrak" }] }),
  component: Reports,
});

const TOOLTIP_STYLE = {
  background: "var(--color-panel)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--color-foreground)",
};

function Reports() {
  const session = useSession();
  const bags = useAppStore((s) => s.bags);
  const alarms = useAppStore((s) => s.alarms);
  const events = useAppStore((s) => s.events);
  const readers = useAppStore((s) => s.readers);
  const resolutions = useAppStore((s) => s.resolutions);
  const [activeReport, setActiveReport] = useState<string | null>(null);

  const reportCards = [
    {
      id: "daily",
      t: "Daily Activity",
      d: "Bags tagged, cleared, and held today.",
      icon: Calendar,
      color: "text-primary",
      stats: [
        { label: "Bags tagged", value: bags.filter((b) => b.status !== "IDENTIFIED").length },
        { label: "Active suspect bags", value: bags.filter((b) => !["RESOLVED", "IDENTIFIED"].includes(b.status)).length },
        { label: "Alarms raised", value: alarms.length },
        { label: "Alarms resolved", value: alarms.filter((a) => !["OPEN", "UNDER_INVESTIGATION", "ESCALATED"].includes(a.outcome)).length },
        { label: "Bags cleared", value: resolutions.filter((r) => r.action === "CLEARED").length },
        { label: "Bags held / seized", value: resolutions.filter((r) => r.action === "NOT_CLEARED" || r.action === "PROHIBITED_ITEM_SEIZED").length },
        { label: "Duty collected", value: resolutions.filter((r) => r.action === "DUTY_COLLECTED").length },
        { label: "Escalated", value: resolutions.filter((r) => r.action === "ESCALATED").length },
      ],
    },
    {
      id: "alarm",
      t: "Alarm Analytics",
      d: "Breakdown by zone, outcome, and response.",
      icon: AlertTriangle,
      color: "text-danger",
      stats: [
        { label: "Total alarms", value: alarms.length },
        { label: "Open", value: alarms.filter((a) => a.outcome === "OPEN").length },
        { label: "Under investigation", value: alarms.filter((a) => a.outcome === "UNDER_INVESTIGATION").length },
        { label: "Escalated", value: alarms.filter((a) => a.outcome === "ESCALATED").length },
        { label: "Cleared", value: alarms.filter((a) => a.outcome === "CLEARED").length },
        { label: "Suppressed", value: alarms.filter((a) => a.outcome === "SUPPRESSED").length },
        ...(() => {
          const zoneCounts: Record<string, number> = {};
          alarms.forEach((a) => { zoneCounts[a.zone] = (zoneCounts[a.zone] || 0) + 1; });
          return Object.entries(zoneCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([zone, count]) => ({ label: `Zone: ${zone.replace(/_/g, " ")}`, value: count }));
        })(),
      ],
    },
    {
      id: "reader",
      t: "Reader Performance",
      d: "Read rates, status, and event counts.",
      icon: Radio,
      color: "text-warning",
      stats: [
        { label: "Total readers", value: readers.length },
        { label: "Online", value: readers.filter((r) => r.status === "ONLINE").length },
        { label: "Degraded", value: readers.filter((r) => r.status === "DEGRADED").length },
        { label: "Offline", value: readers.filter((r) => r.status === "OFFLINE").length },
        { label: "Avg read rate", value: `${Math.round(readers.reduce((s, r) => s + r.readRate, 0) / readers.length)}%` },
        { label: "Total RFID events", value: events.length },
        { label: "Total reads (sum)", value: events.reduce((s, e) => s + e.readCount, 0) },
      ],
    },
    {
      id: "flight",
      t: "Flight Summary",
      d: "Suspect bags grouped by flight.",
      icon: Users,
      color: "text-success",
      stats: (() => {
        const flightCounts: Record<string, { total: number; resolved: number }> = {};
        bags.filter((b) => b.isSuspect).forEach((b) => {
          if (!flightCounts[b.flight]) flightCounts[b.flight] = { total: 0, resolved: 0 };
          flightCounts[b.flight].total++;
          if (b.status === "RESOLVED") flightCounts[b.flight].resolved++;
        });
        return Object.entries(flightCounts).map(([flight, c]) => ({
          label: `${flight}`,
          value: `${c.resolved}/${c.total} resolved`,
        }));
      })(),
    },
    {
      id: "event",
      t: "Event Log Summary",
      d: "RFID event breakdown by type.",
      icon: BarChart3,
      color: "text-info",
      stats: (() => {
        const typeCounts: Record<string, number> = {};
        events.forEach((e) => { typeCounts[e.eventType] = (typeCounts[e.eventType] || 0) + 1; });
        return Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => ({ label: type.replace(/_/g, " "), value: count }));
      })(),
    },
  ];

  const topLocations = (() => {
    const counts: Record<string, number> = {};
    alarms.forEach((a) => {
      const name = a.zone.replace(/_/g, " ");
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, v]) => ({ name, v }));
  })();

  const readerRank = readers
    .slice()
    .sort((a, b) => b.readRate - a.readRate)
    .slice(0, 5)
    .map((r) => ({ name: r.id, v: r.readRate, fullName: r.name }));

  const hourlyTraffic = (() => {
    const counts: Record<string, number> = {};
    for (let h = 0; h < 24; h++) counts[String(h).padStart(2, "0")] = 0;
    events.forEach((e) => {
      const hour = String(new Date(e.firstSeen).getHours()).padStart(2, "0");
      counts[hour] = (counts[hour] || 0) + e.readCount;
    });
    return Object.entries(counts)
      .map(([t, v]) => ({ t, v }))
      .filter((d) => d.v > 0 || (Number(d.t) >= 6 && Number(d.t) <= 22));
  })();

  return (
    <RoleGate userRole={session.role} requiredRole="Operations Officer" pageName="Reports">
    <div className="p-6">
      <PageHeader
        title="Reports"
        subtitle="Operational and compliance reporting for shift, daily, and monthly review."
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => {
                toast.info("Opening print dialog — select 'Save as PDF'");
                window.print();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"
            >
              <FileText className="size-3.5" />PDF
            </button>
            <button
              onClick={() => {
                const bagSheet = "BAGS\nID\tIATA\tFlight\tEPC\tStatus\tZone\n" +
                  bags.map((b) => `${b.id}\t${b.iataCode}\t${b.flight}\t${b.epc ?? ""}\t${b.status}\t${b.currentZone}`).join("\n");

                const alarmSheet = "\n\nALARMS\nID\tBag\tZone\tTriggered\tOutcome\tOfficer\n" +
                  alarms.map((a) => `${a.id}\t${a.bagId}\t${a.zone}\t${a.triggeredAt}\t${a.outcome}\t${a.acknowledgedBy ?? ""}`).join("\n");

                const eventSheet = "\n\nEVENTS\nID\tEPC\tReader\tZone\tType\tTime\tReads\tRSSI\n" +
                  events.map((e) => `${e.id}\t${e.epc}\t${e.readerId}\t${e.zone}\t${e.eventType}\t${e.firstSeen}\t${e.readCount}\t${e.rssi}`).join("\n");

                const blob = new Blob([bagSheet + alarmSheet + eventSheet], { type: "application/vnd.ms-excel" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `beltrak-report-${new Date().toISOString().slice(0, 10)}.xls`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Excel report downloaded");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"
            >
              <FileSpreadsheet className="size-3.5" />Excel
            </button>
            <button
              onClick={() => {
                const header = "Bag ID,IATA,Flight,EPC,Status,Zone,Is Suspect\n";
                const rows = bags.map((b) =>
                  `${b.id},${b.iataCode},${b.flight},${b.epc ?? ""},${b.status},${b.currentZone},${b.isSuspect}`
                ).join("\n");

                const alarmHeader = "\n\nAlarm ID,Bag ID,Zone,Triggered,Outcome,Officer\n";
                const alarmRows = alarms.map((a) =>
                  `${a.id},${a.bagId},${a.zone},${a.triggeredAt},${a.outcome},${a.acknowledgedBy ?? ""}`
                ).join("\n");

                const eventHeader = "\n\nEvent ID,EPC,Reader,Zone,Type,First Seen,Read Count,RSSI\n";
                const eventRows = events.map((e) =>
                  `${e.id},${e.epc},${e.readerId},${e.zone},${e.eventType},${e.firstSeen},${e.readCount},${e.rssi}`
                ).join("\n");

                const blob = new Blob([header + rows + alarmHeader + alarmRows + eventHeader + eventRows], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `beltrak-report-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`Exported ${bags.length} bags, ${alarms.length} alarms, ${events.length} events`);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"
            >
              <FileDown className="size-3.5" />CSV
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        {reportCards.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveReport(activeReport === c.id ? null : c.id)}
            className={`text-left rounded-lg border p-4 transition-colors ${
              activeReport === c.id
                ? "border-primary bg-primary/5"
                : "border-border bg-panel/60 hover:border-primary/40 hover:bg-panel"
            }`}
          >
            <c.icon className={`size-5 ${c.color}`} />
            <div className="mt-2 font-medium text-[14px]">{c.t}</div>
            <div className="text-[11.5px] text-muted-foreground mt-1 leading-snug">{c.d}</div>
            <div className="mt-3 text-[11px] text-primary">
              {activeReport === c.id ? "Hide ↑" : "Generate →"}
            </div>
          </button>
        ))}
      </div>

      {activeReport && (() => {
        const report = reportCards.find((c) => c.id === activeReport);
        if (!report) return null;
        return (
          <Panel
            title={report.t}
            className="mb-6"
            action={
              <button onClick={() => setActiveReport(null)}>
                <X className="size-3.5 text-muted-foreground" />
              </button>
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {report.stats.map((s, i) => (
                <div key={i} className="rounded-md border border-border p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                  <div className="text-xl font-semibold font-mono mt-1">{s.value}</div>
                </div>
              ))}
            </div>
            {report.stats.length === 0 && (
              <div className="py-4 text-center text-[12px] text-muted-foreground">No data — run some scenarios in the Simulator first</div>
            )}
          </Panel>
        );
      })()}

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Alarm Heatmap · This Week" className="col-span-12 xl:col-span-7">
          <div className="grid grid-cols-[60px_repeat(24,1fr)] gap-0.5 text-[10px]">
            <div></div>
            {Array.from({length:24}).map((_,h)=>(<div key={h} className="text-center text-muted-foreground">{h}</div>))}
            {(() => {
              const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
              events.forEach((e) => {
                const d = new Date(e.firstSeen);
                const day = (d.getDay() + 6) % 7;
                const hour = d.getHours();
                grid[day][hour] += e.readCount;
              });
              const maxVal = Math.max(1, ...grid.flat());

              return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dayName, dayIdx) => (
                <div key={dayName} className="contents">
                  <div className="text-muted-foreground py-0.5">{dayName}</div>
                  {grid[dayIdx].map((count, h) => {
                    const op = Math.min(0.9, (count / maxVal) * 0.85 + 0.05);
                    return (
                      <div
                        key={h}
                        className="aspect-square rounded-sm"
                        title={`${dayName} ${h}:00 — ${count} reads`}
                        style={{
                          background: count > 0
                            ? `color-mix(in oklab, var(--color-danger) ${op * 100}%, var(--color-secondary))`
                            : "var(--color-secondary)",
                        }}
                      />
                    );
                  })}
                </div>
              ));
            })()}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Low</span>
            <div className="h-2 flex-1 rounded" style={{ background: "linear-gradient(to right, var(--color-secondary), var(--color-danger))" }} />
            <span>High</span>
          </div>
        </Panel>

        <Panel title="Top Trigger Locations" className="col-span-12 md:col-span-6 xl:col-span-5">
          {topLocations.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={topLocations} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.02 250)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} axisLine={{ stroke: "rgb(60,70,90)" }} tickLine={false}/>
                  <YAxis type="category" dataKey="name" tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} width={140} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={TOOLTIP_STYLE}/>
                  <Bar dataKey="v" fill="oklch(0.65 0.25 25)" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[12px] text-muted-foreground">
              No alarm data yet — run a scenario
            </div>
          )}
        </Panel>

        <Panel title="Reader Performance Ranking · Top 5" className="col-span-12 xl:col-span-7">
          <ul className="space-y-2.5">
            {readerRank.map((r,i) => (
              <li key={r.name} className="flex items-center gap-3">
                <span className="font-mono text-[12px] text-muted-foreground w-6">#{i+1}</span>
                <div className="w-28">
                  <span className="font-mono text-[13px]">{r.name}</span>
                  <div className="text-[10px] text-muted-foreground truncate">{r.fullName}</div>
                </div>
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full ${r.v > 90 ? "bg-success" : r.v > 60 ? "bg-warning" : "bg-danger"}`}
                    style={{ width: `${r.v}%` }} />
                </div>
                <span className="font-mono text-[12px] w-12 text-right">{r.v}%</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Hourly Traffic · Today" className="col-span-12 xl:col-span-5">
          {!hourlyTraffic.every((d) => d.v === 0) ? (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={hourlyTraffic}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.02 250)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} axisLine={{ stroke: "rgb(60,70,90)" }} tickLine={false}/>
                  <YAxis tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} axisLine={{ stroke: "rgb(60,70,90)" }} tickLine={false}/>
                  <Tooltip contentStyle={TOOLTIP_STYLE}/>
                  <Bar dataKey="v" fill="oklch(0.72 0.15 230)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex items-center justify-center text-[12px] text-muted-foreground">
              No traffic data yet — run a scenario
            </div>
          )}
        </Panel>
      </div>
    </div>
    </RoleGate>
  );
}
