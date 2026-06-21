import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { Upload, MapPin, Move, Crosshair } from "lucide-react";
import { MAP_LOCATIONS } from "@/lib/data";

export const Route = createFileRoute("/settings/map")({
  head: () => ({ meta: [{ title: "Map Settings · BELTrak" }] }),
  component: MapSettings,
});

function MapSettings() {
  return (
    <div className="p-6">
      <PageHeader title="Map Settings" subtitle="Floorplans, reader placement, and calibration." />
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Floorplan" className="col-span-12 lg:col-span-3">
          <button className="w-full border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
            <Upload className="size-6 mx-auto text-muted-foreground" />
            <div className="mt-2 text-[13px] font-medium">Upload floorplan</div>
            <div className="text-[11px] text-muted-foreground">SVG, PNG · up to 20 MB</div>
          </button>
          <div className="mt-3 space-y-1.5 text-[12px]">
            {["Ground · Terminal 1.svg","Mezzanine · T1.svg","Departures L1.svg"].map((f) => (
              <div key={f} className="flex items-center justify-between p-2 rounded border border-border bg-background/40">
                <span className="truncate">{f}</span>
                <span className="text-[10px] text-success">ACTIVE</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Reader Placement Canvas" className="col-span-12 lg:col-span-6 !p-0">
          <div className="relative h-[480px] bg-background scan-grid">
            {MAP_LOCATIONS.filter(l => l.kind === "reader" || l.kind === "alarm").map((l) => (
              <div key={l.id} className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-move" style={{ left: `${l.x}%`, top: `${l.y}%` }}>
                <div className="size-6 rounded-md bg-info/20 border-2 border-info flex items-center justify-center">
                  <MapPin className="size-3 text-info" />
                </div>
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted-foreground">{l.name}</div>
              </div>
            ))}
            <div className="absolute top-3 left-3 text-[11px] text-muted-foreground font-mono flex items-center gap-1.5">
              <Move className="size-3" /> Drag readers to reposition · click to edit
            </div>
          </div>
        </Panel>

        <div className="col-span-12 lg:col-span-3 space-y-4">
          <Panel title="Coordinate Editor">
            <div className="text-[12px] space-y-2">
              <div className="font-mono text-[11px] text-muted-foreground">Selected: RDR-022</div>
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-[10px] uppercase text-muted-foreground">X</div><input defaultValue="65.0" className="w-full bg-background border border-border rounded px-2 py-1 font-mono" /></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Y</div><input defaultValue="86.0" className="w-full bg-background border border-border rounded px-2 py-1 font-mono" /></div>
              </div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Rotation</div><input defaultValue="0°" className="w-full bg-background border border-border rounded px-2 py-1 font-mono" /></div>
              <button className="w-full mt-1 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium">Update placement</button>
            </div>
          </Panel>
          <Panel title="Calibration">
            <button className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-border text-[12px] hover:bg-accent"><Crosshair className="size-3.5" />Start calibration</button>
            <div className="text-[11px] text-muted-foreground mt-2">Last calibrated 14 days ago. Pixel-to-meter ratio: <span className="font-mono">0.083</span></div>
          </Panel>
          <Panel title="Mini Map Preview">
            <div className="aspect-square rounded-md border border-border bg-background scan-grid relative">
              {MAP_LOCATIONS.map((l) => <div key={l.id} className={`absolute size-1 rounded-full ${l.kind === "alarm" ? "bg-danger" : l.kind === "reader" ? "bg-info" : "bg-success"}`} style={{ left: `${l.x}%`, top: `${l.y}%` }} />)}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
