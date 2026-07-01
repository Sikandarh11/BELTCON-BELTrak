import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { Printer, ArrowUpRight, StickyNote, Camera, ScanLine, Video } from "lucide-react";

export const Route = createFileRoute("/target")({
  head: () => ({ meta: [{ title: "Target Information · BELTrak" }] }),
  component: Target,
});

const FIELDS = [
  ["Tag ID", "ETB-240091"],
  ["Bag Number", "BG77891"],
  ["Flight", "SV452 · Riyadh → Jeddah"],
  ["Passenger", "Ahmed Al-Harbi"],
  ["Passport", "P4389122"],
  ["Nationality", "Saudi Arabia"],
  ["Status", "ACTIVE"],
  ["Threat Classification", "Suspect Bag"],
  ["Current Location", "Customs Exit Gate 2"],
  ["First Tagged", "08:12:04 · Station 2"],
  ["Dwell Time", "62 min"],
  ["Assigned Officer", "M. Al-Qahtani"],
];

const NOTES = [
  { who: "M. Al-Qahtani", role: "Operations Officer", at: "09:18", text: "Passenger requested secondary inspection. Bag held at gate 2." },
  { who: "S. Khalid", role: "Customs Supervisor", at: "09:24", text: "Organic material flagged on X-Ray. Escalating to recheck station." },
];

function Target() {
  return (
    <div className="p-6">
      <PageHeader
        title="Target Information"
        subtitle="Profile of suspect bag · ETB-240091"
        actions={
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"><Printer className="size-3.5" />Print report</button>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-warning text-primary-foreground text-[12px] font-medium"><ArrowUpRight className="size-3.5" />Escalate</button>
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Bag Information" className="col-span-12 lg:col-span-5">
          <div className="flex items-center gap-3 pb-3 border-b border-border mb-3">
            <div className="size-14 rounded-md bg-danger/15 border border-danger/30 flex items-center justify-center text-2xl">
              🧳
            </div>
            <div>
              <div className="font-mono text-lg font-semibold">ETB-240091</div>
              <div className="text-[12px] text-muted-foreground">Tagged 08:12 · Suspect Tagging Station 2</div>
              <div className="mt-1"><StatusPill status="ACTIVE" /></div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-y-2.5 text-[13px]">
            {FIELDS.map(([k,v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground text-[12px]">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <div className="col-span-12 lg:col-span-7 space-y-4">
          <Panel title="Imagery">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="aspect-[4/3] rounded-md border border-border bg-background/60 relative overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 60" className="w-full h-full p-2 opacity-80">
                      <rect x="10" y="20" width="80" height="25" rx="3" fill="oklch(0.30 0.05 30)" stroke="oklch(0.70 0.20 30)" strokeWidth="0.5"/>
                      <circle cx="35" cy="32" r="4" fill="oklch(0.85 0.20 60)"/>
                      <rect x="50" y="26" width="14" height="10" fill="oklch(0.50 0.18 30)"/>
                      <path d="M70 30 L78 38 L66 38 Z" fill="oklch(0.80 0.18 90)"/>
                    </svg>
                  </div>
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono bg-background/80 px-1.5 py-0.5 rounded border border-border flex items-center gap-1"><ScanLine className="size-3" />X-RAY</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">08:13 · Station 2 · Organic detected</div>
              </div>
              <div>
                <div className="aspect-[4/3] rounded-md border border-border bg-gradient-to-br from-white to-slate-100 relative overflow-hidden flex items-center justify-center text-5xl text-foreground">
                  🎒
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono bg-background/80 px-1.5 py-0.5 rounded border border-border flex items-center gap-1"><Camera className="size-3" />BAG PHOTO</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Black hard-shell · 65L</div>
              </div>
              <div>
                <div className="aspect-[4/3] rounded-md border border-border bg-background/60 relative overflow-hidden">
                  <div className="absolute inset-0 scan-grid opacity-50" />
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px] font-mono">CAM-WC-N-03 · LIVE</div>
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono bg-danger/80 text-destructive-foreground px-1.5 py-0.5 rounded flex items-center gap-1"><Video className="size-3" />CCTV</span>
                  <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-danger animate-pulse" />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">08:32 · Washroom North</div>
              </div>
            </div>
          </Panel>

          <Panel title="Officer Notes" action={<button className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><StickyNote className="size-3" />Add note</button>}>
            <ul className="space-y-3">
              {NOTES.map((n,i) => (
                <li key={i} className="border-l-2 border-primary/40 pl-3">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="font-medium">{n.who}</span>
                    <span className="text-muted-foreground">{n.role}</span>
                    <span className="ml-auto font-mono text-muted-foreground">{n.at}</span>
                  </div>
                  <p className="text-[13px] mt-0.5">{n.text}</p>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-border">
              <textarea rows={2} placeholder="Add a new note…" className="w-full bg-background border border-border rounded p-2 text-[13px]" />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
