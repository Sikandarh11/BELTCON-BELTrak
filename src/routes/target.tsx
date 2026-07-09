import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { alarmService } from "@/services/alarmService";
import { useState } from "react";
import { Printer, ArrowUpRight, StickyNote, Camera, ScanLine, Video } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";

export const Route = createFileRoute("/target")({
  head: () => ({ meta: [{ title: "Target Information · BELTrak" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    bagId: (search.bagId as string) || "",
  }),
  component: Target,
});

interface Note {
  who: string;
  role: string;
  at: string;
  text: string;
}

function Target() {
  const session = useSession();
  const { bagId: paramBagId } = useSearch({ from: "/target" });
  const navigate = useNavigate();
  const bags = useAppStore((s) => s.bags);
  const alarms = useAppStore((s) => s.alarms);
  const events = useAppStore((s) => s.events);
  const [notes, setNotes] = useState<Record<string, Note[]>>({});
  const [newNote, setNewNote] = useState("");

  // Find the bag: from param, or first alarmed/under-recheck bag
  const bag = paramBagId
    ? bags.find((b) => b.id === paramBagId)
    : bags.find((b) => b.status === "ALARMED" || b.status === "UNDER_RECHECK" || b.status === "ESCALATED");

  const bagAlarm = bag
    ? alarms.find((a) => a.bagId === bag.id && a.outcome !== "CLEARED" && a.outcome !== "SUPPRESSED")
    : null;

  const bagEvents = bag?.epc
    ? events.filter((e) => e.epc === bag.epc)
        .sort((a, b) => new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime())
    : [];

  const firstEvent = bagEvents[0];
  const lastEvent = bagEvents[bagEvents.length - 1];
  const dwellMinutes = firstEvent && lastEvent
    ? Math.round((new Date(lastEvent.lastSeen).getTime() - new Date(firstEvent.firstSeen).getTime()) / 60000)
    : 0;

  const bagNotes = bag ? (notes[bag.id] || []) : [];

  function handleAddNote() {
    if (!bag || !newNote.trim()) return;
    const note: Note = {
      who: `${session.firstName} ${session.lastName}`,
      role: session.role,
      at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: newNote.trim(),
    };
    setNotes((prev) => ({
      ...prev,
      [bag.id]: [...(prev[bag.id] || []), note],
    }));
    setNewNote("");
    toast.success("Note added");
  }

  function handleEscalate() {
    if (!bagAlarm) return;
    try {
      alarmService.escalate(bagAlarm.id);
      toast.warning(`Alarm ${bagAlarm.id} escalated`);
    } catch (err: any) {
      toast.error(err.message || "Action failed");
    }
  }

  if (!bag) {
    return (
      <div className="p-6">
        <PageHeader title="Target Information" subtitle="No suspect bag selected" />
        <div className="py-12 text-center text-[13px] text-muted-foreground">
          Select a bag from the Alarms page (click the View icon) or use the Simulator to create one.
        </div>
      </div>
    );
  }

  const FIELDS = [
    ["Tag ID", bag.iataCode],
    ["BHS UID", bag.bhsUid],
    ["Flight", bag.flight],
    ["EPC", bag.epc || "Not assigned"],
    ["Classification", "Suspect Bag"],
    ["Status", bag.status.replace(/_/g, " ")],
    ["Current Location", bag.currentZone.replace(/_/g, " ")],
    ["First Seen", firstEvent
      ? new Date(firstEvent.firstSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "—"],
    ["Dwell Time", `${dwellMinutes} min`],
    ["Assigned Officer", bagAlarm?.acknowledgedBy || "Unassigned"],
    ["Alarm Status", bagAlarm?.outcome.replace(/_/g, " ") || "No alarm"],
    ["Total Reads", String(bagEvents.reduce((sum, e) => sum + e.readCount, 0))],
  ];

  return (
    <div className="p-6">
      <div className="print-only text-center mb-4 pb-3 border-b">
        <div className="text-lg font-bold">BELTrak — Suspect Bag Report</div>
        <div className="text-[11px] text-muted-foreground">
          {bag.iataCode} · {bag.flight} · Printed {new Date().toLocaleString()}
        </div>
      </div>
      <PageHeader
        title="Target Information"
        subtitle={`Profile of suspect bag · ${bag.iataCode}`}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] hover:bg-accent"
            >
              <Printer className="size-3.5" />Print report
            </button>
            {bagAlarm && bagAlarm.outcome !== "ESCALATED" && (
              <button
                onClick={handleEscalate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-warning text-primary-foreground text-[12px] font-medium"
              >
                <ArrowUpRight className="size-3.5" />Escalate
              </button>
            )}
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
              <div className="font-mono text-lg font-semibold">{bag.iataCode}</div>
              <div className="text-[12px] text-muted-foreground">
                {bag.flight} · {bag.currentZone.replace(/_/g, " ")}
              </div>
              <div className="mt-1">
                <StatusPill status={
                  bag.status === "ALARMED" || bag.status === "ESCALATED" ? "ACTIVE"
                  : bag.status === "RESOLVED" ? "Online"
                  : "ACKNOWLEDGED"
                } />
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-y-2.5 text-[13px]">
            {FIELDS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground text-[12px]">{k}</dt>
                <dd className="font-medium font-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <div className="col-span-12 lg:col-span-7 space-y-4">
          <Panel title="Imagery">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="aspect-4/3 rounded-md border border-border bg-background/60 relative overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 60" className="w-full h-full p-2 opacity-80">
                      <rect x="10" y="20" width="80" height="25" rx="3" fill="oklch(0.30 0.05 30)" stroke="oklch(0.70 0.20 30)" strokeWidth="0.5"/>
                      <circle cx="35" cy="32" r="4" fill="oklch(0.85 0.20 60)"/>
                      <rect x="50" y="26" width="14" height="10" fill="oklch(0.50 0.18 30)"/>
                      <path d="M70 30 L78 38 L66 38 Z" fill="oklch(0.80 0.18 90)"/>
                    </svg>
                  </div>
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono bg-background/80 px-1.5 py-0.5 rounded border border-border flex items-center gap-1">
                    <ScanLine className="size-3" />X-RAY
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Placeholder · X-ray scan</div>
              </div>
              <div>
                <div className="aspect-4/3 rounded-md border border-border bg-linear-to-br from-white to-slate-100 relative overflow-hidden flex items-center justify-center text-5xl">
                  🎒
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono bg-background/80 px-1.5 py-0.5 rounded border border-border flex items-center gap-1">
                    <Camera className="size-3" />BAG PHOTO
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Placeholder · Bag photo</div>
              </div>
              <div>
                <div className="aspect-4/3 rounded-md border border-border bg-background/60 relative overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px] font-mono">
                    CCTV · {bag.currentZone.replace(/_/g, " ")}
                  </div>
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono bg-danger/80 text-destructive-foreground px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Video className="size-3" />CCTV
                  </span>
                  <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-danger animate-pulse" />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Placeholder · Live feed</div>
              </div>
            </div>
          </Panel>

          {/* Movement Timeline */}
          <Panel title={`Movement Timeline · ${bagEvents.length} events`}>
            {bagEvents.length > 0 ? (
              <ol className="space-y-1.5 max-h-48 overflow-y-auto text-[12px]">
                {bagEvents.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
                    <span className="font-mono text-muted-foreground w-16">
                      {new Date(e.firstSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className={`size-2 rounded-full shrink-0 ${
                      e.eventType.includes("ALARM") || e.eventType.includes("EXIT") ? "bg-danger"
                      : e.eventType.includes("ESCAPE") || e.eventType.includes("RESTRICTED") ? "bg-warning"
                      : "bg-info"
                    }`} />
                    <span className="flex-1">{e.zone.replace(/_/g, " ")}</span>
                    <span className="font-mono text-muted-foreground">×{e.readCount}</span>
                    <span className="font-mono text-muted-foreground text-[10px]">{e.rssi} dBm</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="py-4 text-center text-[12px] text-muted-foreground">No movement recorded</div>
            )}
          </Panel>

          {/* Officer Notes */}
          <Panel
            title="Officer Notes"
            action={
              <span className="text-[11px] text-muted-foreground">{bagNotes.length} note{bagNotes.length !== 1 ? "s" : ""}</span>
            }
          >
            {bagNotes.length > 0 && (
              <ul className="space-y-3 mb-3">
                {bagNotes.map((n, i) => (
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
            )}
            <div className="pt-3 border-t border-border flex gap-2">
              <textarea
                rows={2}
                placeholder="Add a new note…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddNote(); }}}
                className="flex-1 bg-background border border-border rounded p-2 text-[13px]"
              />
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                className="self-end px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40"
              >
                <StickyNote className="size-3.5" />
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}