import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { KPIS, ACTIVITY, HOURLY_TAGS, ALARM_TREND, THREAT_DIST, READER_HEALTH, TRAFFIC_TREND, ALARMS } from "@/lib/data";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Download, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard · BELTrak" }] }),
  component: Dashboard,
});

const axis = { tick: { fill: "rgb(150,160,180)", fontSize: 11 }, axisLine: { stroke: "rgb(60,70,90)" }, tickLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "oklch(0.22 0.02 250)", border: "1px solid oklch(0.30 0.02 250)", borderRadius: 6, fontSize: 12 },
  labelStyle: { color: "rgb(200,210,230)" },
} as const;

function Dashboard() {
  return (
    <div className="p-6">
      <PageHeader
        title="Operations Dashboard"
        subtitle="King Khalid International Airport — Terminal 1 · Real-time customs visibility"
        actions={
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"><RefreshCw className="size-3.5" />Refresh</button>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"><Download className="size-3.5" />Export shift report</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {KPIS.map((k) => {
          const toneText: Record<string, string> = {
            primary: "text-primary", warning: "text-warning", danger: "text-danger",
            success: "text-success", info: "text-info",
          };
          return (
            <div key={k.label} className="rounded-lg border border-border bg-panel/60 p-3.5 relative overflow-hidden">
              <div className={`absolute inset-x-0 top-0 h-0.5 ${toneText[k.tone]}`} style={{ background: "currentColor" }} />
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k.label}</div>
              <div className={`mt-1.5 text-2xl font-semibold tracking-tight ${toneText[k.tone]}`}>{k.value}</div>
              <div className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1">
                {k.tone === "success" || k.tone === "primary" ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {k.delta}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Bags Tagged Per Hour" className="col-span-12 xl:col-span-5">
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={HOURLY_TAGS}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(31,184,201)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="rgb(31,184,201)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.02 250)" vertical={false} />
                <XAxis dataKey="h" {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="v" stroke="rgb(31,184,201)" strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Alarm Trends · 7d" className="col-span-12 md:col-span-6 xl:col-span-4">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={ALARM_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.02 250)" vertical={false} />
                <XAxis dataKey="d" {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="v" fill="oklch(0.65 0.25 25)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Threat Distribution" className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className="h-56 flex">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={THREAT_DIST} dataKey="value" innerRadius={48} outerRadius={78} paddingAngle={2}>
                  {THREAT_DIST.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 self-center pr-2">
              {THREAT_DIST.map((t) => (
                <div key={t.name} className="flex items-center gap-2 text-[11px]">
                  <span className="size-2 rounded-sm" style={{ background: t.color }} />
                  <span className="text-muted-foreground">{t.name}</span>
                  <span className="font-mono">{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Airport Passenger Traffic" className="col-span-12 xl:col-span-8">
          <div className="h-52">
            <ResponsiveContainer>
              <LineChart data={TRAFFIC_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.02 250)" vertical={false} />
                <XAxis dataKey="t" {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="pax" stroke="oklch(0.72 0.15 230)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Reader Health" className="col-span-12 xl:col-span-4">
          <div className="space-y-3">
            {READER_HEALTH.map((r) => {
              const total = READER_HEALTH.reduce((s, x) => s + x.value, 0);
              const pct = (r.value / total) * 100;
              const color = r.name === "Healthy" ? "bg-success" : r.name === "Degraded" ? "bg-warning" : "bg-danger";
              return (
                <div key={r.name}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span>{r.name}</span>
                    <span className="font-mono text-muted-foreground">{r.value} readers</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="pt-2 border-t border-border text-[11px] text-muted-foreground">
              Last health sweep: <span className="font-mono text-foreground">09:34:18</span>
            </div>
          </div>
        </Panel>

        <Panel title="Live Activity Feed" className="col-span-12 xl:col-span-7">
          <ul className="divide-y divide-border -my-2">
            {ACTIVITY.map((a, i) => {
              const dot = a.level === "danger" ? "bg-danger" : a.level === "warn" ? "bg-warning" : a.level === "success" ? "bg-success" : "bg-info";
              return (
                <li key={i} className="py-2.5 flex items-start gap-3">
                  <span className={`mt-1.5 size-2 rounded-full ${dot} ${a.level === "danger" ? "animate-pulse" : ""}`} />
                  <div className="flex-1 text-[13px]">{a.text}</div>
                  <span className="font-mono text-[11px] text-muted-foreground">{a.time}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Recent Alarms" action={<a href="/alarms" className="text-[11px] text-primary hover:underline">View all →</a>} className="col-span-12 xl:col-span-5">
          <ul className="space-y-2">
            {ALARMS.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-accent/40">
                <span className="font-mono text-[11px] text-muted-foreground w-14">{a.id}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] truncate">{a.threat}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{a.location} · {a.flight}</div>
                </div>
                <StatusPill status={a.status} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
