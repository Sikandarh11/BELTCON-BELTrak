import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { MAP_LOCATIONS, SUSPECT_BAGS_ON_MAP, ACTIVITY } from "@/lib/data";
import { useState } from "react";
import { Plus, Minus, Layers, Building2, Radio, AlertTriangle, X, Briefcase } from "lucide-react";

export const Route = createFileRoute("/map")({
  head: () => ({ meta: [{ title: "Live Operations Map · BELTrak" }] }),
  component: LiveMap,
});

function LiveMap() {
  const [selected, setSelected] = useState<string | null>("ETB-240091");
  const bag = SUSPECT_BAGS_ON_MAP.find((b) => b.tag === selected);

  return (
    <div className="p-6">
      <PageHeader
        title="Live Operations Map"
        subtitle="Ground Floor · Control Hall and Processing Area"
        actions={
          <div className="flex gap-2 text-[12px]">
            <select className="bg-background border border-border rounded-md px-2.5 py-1.5">
              <option>Floor: Ground (G)</option>
              <option>Floor: Mezzanine</option>
              <option>Floor: Departures (L1)</option>
            </select>
            <button className="px-2.5 py-1.5 border border-border rounded-md hover:bg-accent inline-flex items-center gap-1.5"><Layers className="size-3.5" />Layers</button>
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 xl:col-span-9 p-0! overflow-hidden">
          <div className="relative w-full h-160 bg-white scan-grid">
            {/* Floorplan outline */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
              <rect x="4" y="6" width="92" height="88" fill="white" stroke="oklch(0.82 0.02 250)" strokeWidth="0.25" />
              {/* Reclaim hall */}
              <rect x="8" y="18" width="44" height="22" fill="oklch(0.97 0.01 250)" stroke="oklch(0.82 0.02 250)" strokeWidth="0.15" />
              <text x="10" y="22" fontSize="2" fill="rgb(71,85,105)">RECLAIM HALL</text>
              {/* Belts */}
              {[14,28,42].map((x,i)=>(
                <g key={i}>
                  <rect x={x} y="26" width="10" height="8" rx="1" fill="oklch(0.94 0.02 220)" stroke="oklch(0.80 0.03 220)" strokeWidth="0.15"/>
                  <text x={x+1.5} y="31.5" fontSize="1.6" fill="rgb(100,116,139)">Belt {i+1}</text>
                </g>
              ))}
              {/* Arrival hall */}
              <rect x="40" y="42" width="32" height="14" fill="oklch(0.97 0.01 250)" stroke="oklch(0.82 0.02 250)" strokeWidth="0.15" />
              <text x="42" y="46" fontSize="2" fill="rgb(71,85,105)">ARRIVAL HALL</text>
              {/* Customs corridor */}
              <rect x="40" y="74" width="46" height="14" fill="oklch(0.98 0.02 30)" stroke="oklch(0.75 0.10 30)" strokeWidth="0.2" />
              <text x="42" y="78" fontSize="2" fill="rgb(220,140,120)">CUSTOMS CONTROL ZONE</text>
              {/* Washrooms */}
              <rect x="20" y="54" width="14" height="10" fill="oklch(0.97 0.01 250)" stroke="oklch(0.82 0.02 250)" strokeWidth="0.15"/>
              <text x="21" y="58" fontSize="1.6" fill="rgb(71,85,105)">WC N</text>
              <rect x="64" y="64" width="14" height="10" fill="oklch(0.97 0.01 250)" stroke="oklch(0.82 0.02 250)" strokeWidth="0.15"/>
              <text x="65" y="68" fontSize="1.6" fill="rgb(71,85,105)">WC S</text>
              {/* Lost & found */}
              <rect x="72" y="22" width="14" height="10" fill="oklch(0.97 0.01 250)" stroke="oklch(0.82 0.02 250)" strokeWidth="0.15"/>
              <text x="73" y="26" fontSize="1.6" fill="rgb(71,85,105)">L&amp;F</text>

              {/* Movement trails */}
              {SUSPECT_BAGS_ON_MAP.map((b, i) => (
                <line key={i} x1={b.x - 6} y1={b.y - 3} x2={b.x} y2={b.y} stroke={b.status === "ALARM" ? "oklch(0.65 0.25 25)" : "oklch(0.72 0.15 230)"} strokeWidth="0.25" strokeDasharray="0.6 0.4" opacity="0.7" />
              ))}
            </svg>

            {/* Location markers */}
            {MAP_LOCATIONS.map((l) => {
              const color = l.kind === "alarm" ? "bg-danger" : l.kind === "reader" ? "bg-info" : "bg-success";
              return (
                <div key={l.id} className="absolute -translate-x-1/2 -translate-y-1/2 group" style={{ left: `${l.x}%`, top: `${l.y}%` }}>
                  <div className={`size-3 rounded-full ${color} ring-2 ring-background ${l.kind === "alarm" ? "glow-danger" : ""}`} />
                  <div className="absolute left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap text-[9px] font-mono text-muted-foreground opacity-70 group-hover:opacity-100">
                    {l.name}
                  </div>
                </div>
              );
            })}

            {/* Suspect bags */}
            {SUSPECT_BAGS_ON_MAP.map((b) => (
              <button
                key={b.tag}
                onClick={() => setSelected(b.tag)}
                className="absolute -translate-x-1/2 -translate-y-1/2 group"
                style={{ left: `${b.x}%`, top: `${b.y}%` }}
              >
                <div className={`size-5 rounded-md border-2 ${b.status === "ALARM" ? "bg-danger/30 border-danger glow-danger" : "bg-info/30 border-info"} flex items-center justify-center`}>
                  <Briefcase className="size-3 text-foreground" />
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 -top-5 whitespace-nowrap text-[10px] font-mono font-semibold text-foreground bg-background/90 border border-border rounded px-1">
                  {b.tag}
                </div>
              </button>
            ))}

            {/* Zoom controls */}
            <div className="absolute right-3 top-3 flex flex-col rounded-md border border-border bg-panel/90 backdrop-blur">
              <button className="size-8 hover:bg-accent flex items-center justify-center border-b border-border"><Plus className="size-4" /></button>
              <button className="size-8 hover:bg-accent flex items-center justify-center"><Minus className="size-4" /></button>
            </div>
            {/* Legend */}
            <div className="absolute left-3 bottom-3 bg-panel/90 backdrop-blur border border-border rounded-md p-3 text-[11px] space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Legend</div>
              <div className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-info" /> RFID Reader</div>
              <div className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-success" /> Normal Area</div>
              <div className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-danger animate-pulse" /> Active Alarm</div>
              <div className="flex items-center gap-2"><Briefcase className="size-3 text-foreground" /> Suspect Bag</div>
            </div>
            {/* Floor indicator */}
            <div className="absolute right-3 bottom-3 bg-panel/90 backdrop-blur border border-border rounded-md px-3 py-2 text-[11px] flex items-center gap-2">
              <Building2 className="size-3.5 text-primary" />
              <span>Ground Floor · Sector C</span>
            </div>
          </div>
        </Panel>

        {/* Right: drawer + live event stream */}
        <div className="col-span-12 xl:col-span-3 space-y-4">
          {bag ? (
            <Panel title="Suspect Bag Details" action={<button onClick={() => setSelected(null)}><X className="size-3.5 text-muted-foreground" /></button>}>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="size-10 rounded-md bg-danger/15 border border-danger/30 flex items-center justify-center">
                    <Briefcase className="size-5 text-danger" />
                  </div>
                  <div>
                    <div className="font-mono font-semibold">{bag.tag}</div>
                    <StatusPill status={bag.status} />
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-y-1.5 text-[12px]">
                  <dt className="col-span-1 text-muted-foreground">Flight</dt><dd className="col-span-2 font-mono">{bag.flight}</dd>
                  <dt className="col-span-1 text-muted-foreground">Passenger</dt><dd className="col-span-2">{bag.passenger}</dd>
                  <dt className="col-span-1 text-muted-foreground">Location</dt><dd className="col-span-2">Custom Exit Gate 02</dd>
                  <dt className="col-span-1 text-muted-foreground">First seen</dt><dd className="col-span-2 font-mono">08:12:04</dd>
                  <dt className="col-span-1 text-muted-foreground">Dwell time</dt><dd className="col-span-2 font-mono text-warning">62 min</dd>
                </dl>
                <div className="flex gap-2 pt-1">
                  <a href="/target" className="flex-1 text-center text-[12px] px-2.5 py-1.5 rounded-md border border-border hover:bg-accent">Open profile</a>
                  <button className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md bg-danger text-destructive-foreground font-medium">Escalate</button>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Suspect Bag Details"><div className="text-[12px] text-muted-foreground py-6 text-center">Select a bag on the map to inspect.</div></Panel>
          )}

          <Panel title="Reader Status Overlay">
            <div className="space-y-1.5 text-[12px]">
              {[
                { n: "RDR-010 · Custom Exit Gate 01", s: "Online" },
                { n: "RDR-011 · Custom Exit Gate 02", s: "Online" },
                { n: "RDR-004 · Tagging Station 04", s: "Degraded" },
                { n: "RDR-013 · Custom Exit Gate 04", s: "Offline" },
              ].map((r) => (
                <div key={r.n} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                  <div className="flex items-center gap-2"><Radio className="size-3 text-muted-foreground" />{r.n}</div>
                  <StatusPill status={r.s} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Live Event Stream">
            <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {ACTIVITY.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-[11.5px]">
                  <span className="font-mono text-muted-foreground">{a.time}</span>
                  <AlertTriangle className={`size-3 mt-0.5 ${a.level === "danger" ? "text-danger" : a.level === "warn" ? "text-warning" : "text-info"}`} />
                  <span className="flex-1">{a.text}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
