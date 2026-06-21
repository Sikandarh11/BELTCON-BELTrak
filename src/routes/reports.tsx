import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { FileText, FileSpreadsheet, FileDown, Calendar, BarChart3, Users, Radio, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports · BELTrak" }] }),
  component: Reports,
});

const CARDS = [
  { t: "Daily Activity", d: "Bags tagged, cleared, and held in the last 24 hours.", icon: Calendar, color: "text-primary" },
  { t: "Weekly Trends", d: "Customs activity and alarm volume rolling 7-day view.", icon: BarChart3, color: "text-info" },
  { t: "Alarm Analytics", d: "Breakdown by threat, location, and response time.", icon: AlertTriangle, color: "text-danger" },
  { t: "Reader Performance", d: "Read rates, downtime, and antenna degradation ranking.", icon: Radio, color: "text-warning" },
  { t: "Passenger Statistics", d: "Demographics, flight loads, and risk profile aggregation.", icon: Users, color: "text-success" },
];

const TOP_LOCATIONS = [
  { name: "Customs Exit Gate 2", v: 38 },
  { name: "Washroom North", v: 27 },
  { name: "Customs Exit Gate 1", v: 19 },
  { name: "Reclaim Belt 3", v: 14 },
  { name: "Lost & Found", v: 8 },
];

const READER_RANK = [
  { name: "RDR-022", v: 99 },
  { name: "RDR-021", v: 99 },
  { name: "RDR-004", v: 99 },
  { name: "RDR-001", v: 98 },
  { name: "RDR-023", v: 97 },
];

function Reports() {
  return (
    <div className="p-6">
      <PageHeader
        title="Reports"
        subtitle="Operational and compliance reporting for shift, daily, and monthly review."
        actions={
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"><FileText className="size-3.5" />PDF</button>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"><FileSpreadsheet className="size-3.5" />Excel</button>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"><FileDown className="size-3.5" />CSV</button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        {CARDS.map((c) => (
          <button key={c.t} className="text-left rounded-lg border border-border bg-panel/60 p-4 hover:border-primary/40 hover:bg-panel transition-colors">
            <c.icon className={`size-5 ${c.color}`} />
            <div className="mt-2 font-medium text-[14px]">{c.t}</div>
            <div className="text-[11.5px] text-muted-foreground mt-1 leading-snug">{c.d}</div>
            <div className="mt-3 text-[11px] text-primary">Generate →</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Alarm Heatmap · This Week" className="col-span-12 xl:col-span-7">
          <div className="grid grid-cols-[60px_repeat(24,1fr)] gap-0.5 text-[10px]">
            <div></div>
            {Array.from({length:24}).map((_,h)=>(<div key={h} className="text-center text-muted-foreground">{h}</div>))}
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
              <div key={d} className="contents">
                <div className="text-muted-foreground py-0.5">{d}</div>
                {Array.from({length:24}).map((_,h)=>{
                  const v = Math.abs(Math.sin(h*0.6 + d.charCodeAt(0)))*100;
                  const op = Math.min(0.9, v/120 + 0.05);
                  return <div key={h} className="aspect-square rounded-sm" style={{ background: `color-mix(in oklab, var(--color-danger) ${op*100}%, var(--color-secondary))` }} />;
                })}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Low</span>
            <div className="h-2 flex-1 rounded" style={{ background: "linear-gradient(to right, var(--color-secondary), var(--color-danger))" }} />
            <span>High</span>
          </div>
        </Panel>

        <Panel title="Top Trigger Locations" className="col-span-12 md:col-span-6 xl:col-span-5">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={TOP_LOCATIONS} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.02 250)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} axisLine={{ stroke: "rgb(60,70,90)" }} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} width={140} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{ background: "oklch(0.22 0.02 250)", border: "1px solid oklch(0.30 0.02 250)", borderRadius: 6, fontSize: 12 }}/>
                <Bar dataKey="v" fill="oklch(0.65 0.25 25)" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Reader Performance Ranking · Top 5" className="col-span-12 xl:col-span-7">
          <ul className="space-y-2.5">
            {READER_RANK.map((r,i) => (
              <li key={r.name} className="flex items-center gap-3">
                <span className="font-mono text-[12px] text-muted-foreground w-6">#{i+1}</span>
                <span className="font-mono text-[13px] w-24">{r.name}</span>
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-success" style={{ width: `${r.v}%` }} />
                </div>
                <span className="font-mono text-[12px] w-12 text-right">{r.v}%</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Hourly Traffic · Today" className="col-span-12 xl:col-span-5">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={[
                {t:"06",v:120},{t:"07",v:220},{t:"08",v:380},{t:"09",v:540},
                {t:"10",v:610},{t:"11",v:520},{t:"12",v:430},{t:"13",v:380},
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.02 250)" vertical={false} />
                <XAxis dataKey="t" tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} axisLine={{ stroke: "rgb(60,70,90)" }} tickLine={false}/>
                <YAxis tick={{ fill: "rgb(150,160,180)", fontSize: 11 }} axisLine={{ stroke: "rgb(60,70,90)" }} tickLine={false}/>
                <Tooltip contentStyle={{ background: "oklch(0.22 0.02 250)", border: "1px solid oklch(0.30 0.02 250)", borderRadius: 6, fontSize: 12 }}/>
                <Bar dataKey="v" fill="oklch(0.72 0.15 230)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}
