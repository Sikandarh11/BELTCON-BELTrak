import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { alarmService } from "@/services/alarmService";
import { ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight, CheckCircle2, PauseCircle, ArrowUpRight, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/recheck")({
  head: () => ({ meta: [{ title: "Recheck Station · BELTrak" }] }),
  component: Recheck,
});

function Recheck() {
  const bags = useAppStore((s) => s.bags);
  const alarms = useAppStore((s) => s.alarms);
  const events = useAppStore((s) => s.events);

  const [searchTerm, setSearchTerm] = useState("");

  const recheckBags = bags.filter(
    (b) => b.status === "ALARMED" || b.status === "UNDER_RECHECK"
  );
  const currentBag = searchTerm
    ? bags.find((b) => b.iataCode === searchTerm || b.epc === searchTerm)
    : recheckBags[0] ?? null;

  const bagAlarm = currentBag
    ? alarms.find((a) => a.bagId === currentBag.id && a.outcome !== "CLEARED" && a.outcome !== "SUPPRESSED")
    : null;

  const bagEvents = currentBag
    ? events.filter((e) => e.epc === currentBag.epc).sort((a, b) =>
        new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime()
      )
    : [];

  return (
    <div className="p-6">
      <PageHeader
        title="Recheck Station · Bay 2"
        subtitle="Customs officer secondary inspection · ETB-240091"
        actions={<StatusPill status={currentBag ? "ACTIVE" : "CLOSED"} />}
      />

      <div className="flex gap-2 mb-4">
        <input
          placeholder="Search by IATA code or EPC..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-[13px] font-mono"
        />
        <button
          onClick={() => setSearchTerm("")}
          className="px-3 py-2 border border-border rounded-md text-[12px] hover:bg-accent"
        >
          Show next pending
        </button>
        <span className="self-center text-[12px] text-muted-foreground">
          {recheckBags.length} bag{recheckBags.length !== 1 ? "s" : ""} pending
        </span>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Panel title="X-Ray Viewer" className="col-span-12 xl:col-span-8 p-0! overflow-hidden">
          <div className="relative bg-white h-140 flex items-center justify-center">
            {/* X-ray visualization */}
            <svg viewBox="0 0 400 240" className="w-[90%] h-[90%]">
              <defs>
                <linearGradient id="xrayBg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f8fafc"/>
                  <stop offset="100%" stopColor="#e2e8f0"/>
                </linearGradient>
              </defs>
              <rect width="400" height="240" fill="url(#xrayBg)"/>
              {/* Suitcase outline */}
              <rect x="40" y="60" width="320" height="130" rx="12" fill="rgba(40,120,90,0.35)" stroke="rgba(120,220,180,0.6)" strokeWidth="1.2"/>
              {/* Handle */}
              <rect x="170" y="48" width="60" height="14" rx="4" fill="rgba(120,220,180,0.4)"/>
              {/* Organic mass — orange */}
              <ellipse cx="160" cy="135" rx="42" ry="26" fill="rgba(240,140,40,0.55)" stroke="rgba(255,180,80,0.8)" strokeWidth="1"/>
              <text x="160" y="138" textAnchor="middle" fontSize="10" fill="#ffd28a">ORGANIC</text>
              {/* Metallic items — blue */}
              <rect x="240" y="100" width="60" height="40" fill="rgba(70,140,240,0.55)" stroke="rgba(140,200,255,0.8)" strokeWidth="1"/>
              <circle cx="280" cy="160" r="10" fill="rgba(70,140,240,0.55)"/>
              {/* Cable */}
              <path d="M220 130 Q260 110 295 145 Q310 165 280 175" fill="none" stroke="rgba(70,140,240,0.7)" strokeWidth="3"/>
              {/* Crosshair */}
              <g stroke="rgba(220,38,38,0.8)" strokeWidth="0.8">
                <line x1="160" y1="100" x2="160" y2="170"/>
                <line x1="125" y1="135" x2="195" y2="135"/>
                <circle cx="160" cy="135" r="44" fill="none" strokeDasharray="3 3"/>
              </g>
            </svg>

            {/* HUD overlays */}
            <div className="absolute top-3 left-3 text-[11px] font-mono text-emerald-700 space-y-0.5">
              <div>BAY · 02</div>
              <div>SCAN · 08:13:22</div>
              <div>OP · M.AL-QAHTANI</div>
            </div>
            <div className="absolute top-3 right-3 text-[11px] font-mono text-amber-700 space-y-0.5 text-right">
              <div>kV · 160</div>
              <div>mA · 1.3</div>
              <div className="text-rose-400">⚠ ORGANIC DETECTED</div>
            </div>

            {/* Controls */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-md border border-border bg-panel/90 backdrop-blur p-1">
              <button className="size-9 hover:bg-accent rounded flex items-center justify-center"><ChevronLeft className="size-4 text-slate-700" /></button>
              <button className="size-9 hover:bg-accent rounded flex items-center justify-center"><ZoomOut className="size-4 text-slate-700" /></button>
              <button className="size-9 hover:bg-accent rounded flex items-center justify-center"><ZoomIn className="size-4 text-slate-700" /></button>
              <button className="size-9 hover:bg-accent rounded flex items-center justify-center"><RotateCw className="size-4 text-slate-700" /></button>
              <button className="size-9 hover:bg-accent rounded flex items-center justify-center"><ChevronRight className="size-4 text-slate-700" /></button>
              <span className="font-mono text-[11px] text-muted-foreground px-2">3 / 8</span>
            </div>
          </div>
        </Panel>

        <div className="col-span-12 xl:col-span-4 space-y-4">
          <Panel title="Bag Details">
            {currentBag ? (
              <dl className="grid grid-cols-3 gap-y-2 text-[13px]">
                <dt className="text-muted-foreground text-[12px]">Tag</dt><dd className="col-span-2 font-mono">{currentBag.iataCode}</dd>
                <dt className="text-muted-foreground text-[12px]">Flight</dt><dd className="col-span-2 font-mono">{currentBag.flight}</dd>
                <dt className="text-muted-foreground text-[12px]">Passenger</dt><dd className="col-span-2">—</dd>
                <dt className="text-muted-foreground text-[12px]">Passport</dt><dd className="col-span-2 font-mono">—</dd>
                <dt className="text-muted-foreground text-[12px]">Reason</dt><dd className="col-span-2 text-warning">{alarms.find((a) => a.bagId === currentBag.id)?.zone.replace(/_/g, " ") ?? "Secondary inspection"}</dd>
                <dt className="text-muted-foreground text-[12px]">Status</dt><dd className="col-span-2"><StatusPill status={currentBag.status === "ALARMED" ? "ACTIVE" : "ACKNOWLEDGED"} /></dd>
              </dl>
            ) : (
              <div className="py-6 text-center text-[12px] text-muted-foreground">No bags pending recheck</div>
            )}
          </Panel>

          <Panel title={`Movement Timeline${currentBag ? ` · ${currentBag.iataCode}` : ""}`}>
            {bagEvents.length > 0 ? (
              <ol className="space-y-2 max-h-48 overflow-y-auto text-[12px]">
                {bagEvents.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 py-1 border-b border-border last:border-0">
                    <span className="font-mono text-muted-foreground w-14">
                      {new Date(e.firstSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`size-2 rounded-full ${
                      e.eventType.includes("ALARM") || e.eventType.includes("EXIT") ? "bg-danger" : "bg-info"
                    }`} />
                    <span className="flex-1">{e.zone.replace(/_/g, " ")}</span>
                    <span className="font-mono text-muted-foreground">×{e.readCount}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="py-4 text-center text-[12px] text-muted-foreground">No events recorded</div>
            )}
          </Panel>

          <Panel title="Officer Notes">
            <textarea rows={3} defaultValue="Organic dense mass located in left quadrant. Suspect food product or wrapped substance. Recommend physical search." className="w-full bg-background border border-border rounded p-2 text-[12.5px]" />
          </Panel>

          <div className="grid grid-cols-1 gap-2">
            {currentBag && bagAlarm ? (
              <>
                <button onClick={() => { alarmService.resolve(bagAlarm.id, "CLEARED", "current-user"); setSearchTerm(""); }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-success/90 hover:bg-success text-primary-foreground font-medium text-[13px]">
                  <CheckCircle2 className="size-4" />Cleared
                </button>
                <button onClick={() => { alarmService.resolve(bagAlarm.id, "NOT_CLEARED", "current-user"); setSearchTerm(""); }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-warning/90 hover:bg-warning text-primary-foreground font-medium text-[13px]">
                  <PauseCircle className="size-4" />Not Cleared — Hold
                </button>
                <button onClick={() => { alarmService.resolve(bagAlarm.id, "DUTY_COLLECTED", "current-user"); setSearchTerm(""); }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-info/90 hover:bg-info text-primary-foreground font-medium text-[13px]">
                  <CheckCircle2 className="size-4" />Duty Collected
                </button>
                <button onClick={() => { alarmService.resolve(bagAlarm.id, "PROHIBITED_ITEM_SEIZED", "current-user"); setSearchTerm(""); }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-danger hover:bg-danger/90 text-destructive-foreground font-medium text-[13px]">
                  <AlertTriangle className="size-4" />Seized — Prohibited Item
                </button>
                <button onClick={() => { alarmService.resolve(bagAlarm.id, "ESCALATED", "current-user"); setSearchTerm(""); }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium text-[13px]">
                  <ArrowUpRight className="size-4" />Escalate to Supervisor
                </button>
              </>
            ) : (
              <div className="py-4 text-center text-[12px] text-muted-foreground">
                {currentBag ? "No open alarm for this bag" : "No bag selected"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
