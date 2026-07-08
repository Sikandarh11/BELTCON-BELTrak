import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Radio, Zap, RotateCcw, Play, Ghost, ToggleLeft, ToggleRight } from "lucide-react";

import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { FLIGHTS } from "@/mocks/seed";
import { bagService } from "@/services/bagService";
import { eventService } from "@/services/eventService";
import { useAppStore } from "@/store/appStore";

export const Route = createFileRoute("/simulator")({
  head: () => ({ meta: [{ title: "Simulator · BELTrak" }] }),
  component: Simulator,
});

const JOURNEY_ZONES = [
  { zone: "RECLAIM_BELT_1", reader: "RDR-001", label: "Reclaim Belt" },
  { zone: "ARRIVAL_HALL", reader: "RDR-004", label: "Arrival Hall" },
  { zone: "WASHROOM_NORTH", reader: "RDR-019", label: "Washroom" },
  { zone: "CUSTOMS_EXIT_GATE_1", reader: "RDR-021", label: "Exit Gate 1" },
] as const;

const RESTRICTED_JOURNEY = [
  { zone: "RECLAIM_BELT_1", reader: "RDR-001", label: "Reclaim Belt" },
  { zone: "EMPLOYEE_EXIT", reader: "RDR-007", label: "Employee Exit" },
  { zone: "EMERGENCY_DOOR", reader: "RDR-031", label: "Emergency Door" },
] as const;

const FULL_CLEARED_JOURNEY = [
  { zone: "RECLAIM_BELT_1", reader: "RDR-001", label: "Reclaim Belt" },
  { zone: "ARRIVAL_HALL", reader: "RDR-004", label: "Arrival Hall" },
  { zone: "CUSTOMS_EXIT_GATE_1", reader: "RDR-021", label: "Exit Gate 1" },
  { zone: "HBSS_RECHECK", reader: "RDR-030", label: "Recheck Station" },
] as const;

type JourneyStop = { zone: string; reader: string; label: string };

let flagCounter = 0;

function Simulator() {
  const bags = useAppStore((s) => s.bags);
  const alarms = useAppStore((s) => s.alarms);
  const events = useAppStore((s) => s.events);
  const readers = useAppStore((s) => s.readers);
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  const activeBags = bags.filter((b) => b.epc && b.status !== "RESOLVED" && b.status !== "IDENTIFIED");
  const selectedBag = selectedBagId ? bags.find((b) => b.id === selectedBagId) : null;

  function handleFlagBag() {
    flagCounter += 1;
    const flight = FLIGHTS[Math.floor(Math.random() * FLIGHTS.length)];
    const bag = bagService.createBagFromSuspectFlag({
      bhsUid: `BHS-SIM-${String(flagCounter).padStart(3, "0")}`,
      iataCode: `ETB-SIM-${String(flagCounter).padStart(3, "0")}`,
      flight,
    });
    toast.info(`Suspect bag flagged: ${bag.iataCode}`, { description: `Flight ${flight} → go to Tagging Station to encode` });
  }

  function handleZoneRead(zone: string, readerId: string) {
    if (!selectedBag?.epc) {
      toast.error("Select a tagged bag first");
      return;
    }

    const result = eventService.ingestRead(selectedBag.epc, readerId, zone);
    toast.info(`Read result: ${result}`, { description: `${selectedBag.iataCode} at ${zone.replace(/_/g, " ")}` });
  }

  function handleBurstReads() {
    if (!selectedBag?.epc) {
      toast.error("Select a tagged bag first");
      return;
    }

    let merged = 0;
    for (let index = 0; index < 15; index += 1) {
      const result = eventService.ingestRead(selectedBag.epc, "RDR-021", "CUSTOMS_EXIT_GATE_1");
      if (result === "merged") merged += 1;
    }
    toast.info(`Burst: 15 reads → ${merged} merged, ${15 - merged} new`, { description: "Dedup engine working" });
  }

  function handleForeignEpc() {
    const result = eventService.ingestRead("EPC-FOREIGN-999", "RDR-021", "CUSTOMS_EXIT_GATE_1");
    toast.warning(`Foreign EPC result: ${result}`, { description: "Unregistered tag — read discarded, no alarm" });
  }

  function handleToggleReader(readerId: string) {
    const reader = readers.find((item) => item.id === readerId);
    if (!reader) return;

    const newStatus = reader.status === "ONLINE" ? "OFFLINE" : "ONLINE";
    useAppStore.getState().updateReader(readerId, { status: newStatus });
    toast.info(`${reader.name} → ${newStatus}`);
  }

  async function handleAutoJourney(zones: readonly JourneyStop[]) {
    if (!selectedBag?.epc) {
      toast.error("Select a tagged bag first");
      return;
    }

    setAutoRunning(true);
    for (const stop of zones) {
      eventService.ingestRead(selectedBag.epc, stop.reader, stop.zone);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setAutoRunning(false);
    toast.success("Journey complete");
  }

  function handleReset() {
    useAppStore.getState().reset();
    eventService.clearCache();
    setSelectedBagId(null);
    flagCounter = 0;
    toast.info("System reset to seed state");
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Simulator Panel"
        subtitle="Mock external systems — BHS flag, RFID reads, reader health"
        actions={
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-accent"
          >
            <RotateCcw className="size-3.5" />
            Reset to seed
          </button>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 space-y-4 lg:col-span-3">
          <Panel title="BHS — Flag Suspect Bag">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Simulates a BHS controller flagging a bag as suspect. Creates an IDENTIFIED bag → go to Tagging Station to encode.
            </p>
            <button
              onClick={handleFlagBag}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-[13px] font-medium text-primary-foreground"
            >
              <Plus className="size-4" />
              Flag Suspect Bag
            </button>
          </Panel>

          <Panel title="Select Active Bag">
            {activeBags.length === 0 ? (
              <div className="py-4 text-center text-[12px] text-muted-foreground">No tagged bags — flag + encode one first</div>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {activeBags.map((bag) => (
                  <li key={bag.id}>
                    <button
                      onClick={() => setSelectedBagId(bag.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-[12px] ${
                        selectedBagId === bag.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold">{bag.iataCode}</span>
                        <StatusPill
                          status={bag.status === "ALARMED" || bag.status === "ESCALATED" ? "ACTIVE" : bag.status === "RESOLVED" ? "Online" : "ACKNOWLEDGED"}
                        />
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        {bag.epc} · {bag.currentZone.replace(/_/g, " ")}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="col-span-12 space-y-4 lg:col-span-5">
          <Panel title="RFID Zone Read (manual)">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Simulate a reader detecting the selected bag at a zone.{!selectedBag && " Select a bag first."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { zone: "RECLAIM_BELT_1", reader: "RDR-001", label: "Reclaim Belt 1" },
                { zone: "ARRIVAL_HALL", reader: "RDR-004", label: "Arrival Hall" },
                { zone: "WASHROOM_NORTH", reader: "RDR-019", label: "Washroom North" },
                { zone: "LOST_FOUND", reader: "RDR-012", label: "Lost & Found" },
                { zone: "CUSTOMS_EXIT_GATE_1", reader: "RDR-021", label: "Exit Gate 1" },
                { zone: "CUSTOMS_EXIT_GATE_2", reader: "RDR-022", label: "Exit Gate 2" },
                { zone: "CUSTOMS_EXIT_GATE_3", reader: "RDR-023", label: "Exit Gate 3" },
                { zone: "EMPLOYEE_EXIT", reader: "RDR-007", label: "Employee Exit" },
                { zone: "EMERGENCY_DOOR", reader: "RDR-031", label: "Emergency Door" },
                { zone: "HBSS_RECHECK", reader: "RDR-030", label: "Recheck Station" },
              ].map((zone) => (
                <button
                  key={zone.zone}
                  onClick={() => handleZoneRead(zone.zone, zone.reader)}
                  disabled={!selectedBag?.epc}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-[12px] font-medium disabled:opacity-30 ${
                    zone.zone.includes("EXIT") || zone.zone.includes("EMERGENCY")
                      ? "border-danger/30 text-danger hover:bg-danger/5"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <Radio className="size-3" />
                  {zone.label}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Auto Journeys">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Auto-move the selected bag through a journey. Each stop fires a read every 2 seconds.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => void handleAutoJourney(JOURNEY_ZONES)}
                disabled={!selectedBag?.epc || autoRunning}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40"
              >
                <Play className="size-4" />
                Journey A — Reclaim → Hall → Exit (alarm)
              </button>
              <button
                onClick={() => void handleAutoJourney(RESTRICTED_JOURNEY)}
                disabled={!selectedBag?.epc || autoRunning}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-warning px-3 py-2.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40"
              >
                <Play className="size-4" />
                Journey C — Reclaim → Employee Exit → Emergency Door
              </button>
              <button
                onClick={() => void handleAutoJourney(FULL_CLEARED_JOURNEY)}
                disabled={!selectedBag?.epc || autoRunning}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-primary px-3 py-2.5 text-[13px] font-medium text-primary disabled:opacity-40"
              >
                <Play className="size-4" />
                Journey Full — Reclaim → Exit → Recheck (alarm + ack needed)
              </button>
              {autoRunning ? <div className="animate-pulse text-center text-[12px] text-muted-foreground">Journey running...</div> : null}
            </div>
          </Panel>
        </div>

        <div className="col-span-12 space-y-4 lg:col-span-4">
          <Panel title="Edge Case Tests">
            <div className="space-y-2">
              <button
                onClick={handleBurstReads}
                disabled={!selectedBag?.epc}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent disabled:opacity-30"
              >
                <Zap className="size-3.5" />
                Burst 15 reads (test dedup)
              </button>
              <button
                onClick={handleForeignEpc}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent"
              >
                <Ghost className="size-3.5" />
                Foreign EPC read (test discard)
              </button>
            </div>
          </Panel>

          <Panel title="Reader Health Toggle">
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {readers.map((reader) => (
                <li key={reader.id} className="flex items-center justify-between border-b border-border py-1.5 text-[12px] last:border-0">
                  <span className="flex-1 truncate">{reader.name}</span>
                  <button onClick={() => handleToggleReader(reader.id)}>
                    {reader.status === "ONLINE" ? <ToggleRight className="size-5 text-success" /> : <ToggleLeft className="size-5 text-muted-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Live Stats">
            <dl className="grid grid-cols-2 gap-y-2 text-[12px]">
              <dt className="text-muted-foreground">Total bags</dt>
              <dd className="font-mono font-semibold">{bags.length}</dd>
              <dt className="text-muted-foreground">Active bags</dt>
              <dd className="font-mono font-semibold">{bags.filter((bag) => bag.status !== "RESOLVED" && bag.status !== "IDENTIFIED").length}</dd>
              <dt className="text-muted-foreground">Open alarms</dt>
              <dd className="font-mono font-semibold text-danger">{alarms.filter((alarm) => alarm.outcome === "OPEN").length}</dd>
              <dt className="text-muted-foreground">Total events</dt>
              <dd className="font-mono font-semibold">{events.length}</dd>
              <dt className="text-muted-foreground">Readers online</dt>
              <dd className="font-mono font-semibold">{readers.filter((reader) => reader.status === "ONLINE").length} / {readers.length}</dd>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}