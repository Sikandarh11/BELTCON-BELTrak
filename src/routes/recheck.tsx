import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight, CheckCircle2, PauseCircle, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/recheck")({
  head: () => ({ meta: [{ title: "Recheck Station · BELTrak" }] }),
  component: Recheck,
});

function Recheck() {
  return (
    <div className="p-6">
      <PageHeader
        title="Recheck Station · Bay 2"
        subtitle="Customs officer secondary inspection · ETB-240091"
        actions={<StatusPill status="ACTIVE" />}
      />

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
            <dl className="grid grid-cols-3 gap-y-2 text-[13px]">
              <dt className="text-muted-foreground text-[12px]">Tag</dt><dd className="col-span-2 font-mono">ETB-240091</dd>
              <dt className="text-muted-foreground text-[12px]">Flight</dt><dd className="col-span-2 font-mono">SV452</dd>
              <dt className="text-muted-foreground text-[12px]">Passenger</dt><dd className="col-span-2">Ahmed Al-Harbi</dd>
              <dt className="text-muted-foreground text-[12px]">Passport</dt><dd className="col-span-2 font-mono">P4389122</dd>
              <dt className="text-muted-foreground text-[12px]">Reason</dt><dd className="col-span-2 text-warning">Organic Material Detected</dd>
              <dt className="text-muted-foreground text-[12px]">Risk Score</dt><dd className="col-span-2"><span className="font-mono text-danger font-semibold">78 / 100</span></dd>
            </dl>
          </Panel>

          <Panel title="Previous Scans">
            <div className="grid grid-cols-4 gap-2">
              {[1,2,3,4,5,6,7,8].map((i) => (
                <div key={i} className={`aspect-square rounded border ${i === 3 ? "border-primary" : "border-border"} bg-emerald-50 relative`}>
                  <div className="absolute inset-1 rounded-sm bg-emerald-200/40" />
                  <span className="absolute bottom-0.5 right-1 text-[9px] font-mono text-emerald-700/80">{String(i).padStart(2,"0")}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Officer Notes">
            <textarea rows={3} defaultValue="Organic dense mass located in left quadrant. Suspect food product or wrapped substance. Recommend physical search." className="w-full bg-background border border-border rounded p-2 text-[12.5px]" />
          </Panel>

          <div className="grid grid-cols-1 gap-2">
            <button className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-success/90 hover:bg-success text-primary-foreground font-medium text-[13px]"><CheckCircle2 className="size-4" />Clear Bag</button>
            <button className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-warning/90 hover:bg-warning text-primary-foreground font-medium text-[13px]"><PauseCircle className="size-4" />Hold Bag</button>
            <button className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-danger hover:bg-danger/90 text-destructive-foreground font-medium text-[13px]"><ArrowUpRight className="size-4" />Send to Supervisor</button>
          </div>
        </div>
      </div>
    </div>
  );
}
