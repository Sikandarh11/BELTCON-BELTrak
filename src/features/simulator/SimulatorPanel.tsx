import { useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Ghost, Plus, Play, Radio, RotateCcw, ToggleLeft, ToggleRight, Zap } from "lucide-react";

import { useSession } from "@/auth/SessionContext";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { RoleGate } from "@/components/RoleGate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FLIGHTS } from "@/mocks/seed";
import { bagService, type FlagSuspectInput } from "@/services/bagService";
import { eventService } from "@/services/eventService";
import { useAppStore } from "@/store/appStore";

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

const SIM_ORIGINS = ["RUH", "JED", "DMM", "DXB"];
type JourneyStop = { zone: string; reader: string; label: string };

let flagCounter = 0;

function nextSixDigits() {
  flagCounter += 1;
  return String((Date.now() + flagCounter) % 1_000_000).padStart(6, "0");
}

function createFlagForm(threatType = "Suspect Bag"): FlagSuspectInput {
  const sequence = nextSixDigits();
  return {
    id: `ETB-SIM-${sequence}`,
    bhsUid: `BHS-${sequence}`,
    flightNo: FLIGHTS[0],
    iataOrigin: "RUH",
    passengerName: `SIM PAX ${flagCounter}`,
    threatType,
    notes: "",
  };
}

export function SimulatorPanel() {
  const session = useSession();
  const bags = useAppStore((state) => state.bags);
  const alarms = useAppStore((state) => state.alarms);
  const events = useAppStore((state) => state.events);
  const readers = useAppStore((state) => state.readers);
  const threatTypes = useAppStore((state) => state.threatTypes);
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [batchCount, setBatchCount] = useState(3);
  const [flagForm, setFlagForm] = useState<FlagSuspectInput>(() => createFlagForm(threatTypes[0]));

  const activeBags = bags.filter((bag) => bag.status === "TAGGED" || bag.status === "IN_TRANSIT");
  const identifiedBags = bags.filter((bag) => bag.status === "IDENTIFIED");
  const selectedBag = selectedBagId ? (bags.find((bag) => bag.id === selectedBagId) ?? null) : null;
  const selectedBagCanRead =
    selectedBag?.status === "TAGGED" || selectedBag?.status === "IN_TRANSIT";

  function openFlagModal() {
    setFlagForm(createFlagForm(threatTypes[0]));
    setFlagModalOpen(true);
  }

  async function handleFlagBag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[A-Za-z]{3}$/.test(flagForm.iataOrigin ?? "")) {
      toast.error("IATA origin must be exactly three letters");
      return;
    }
    setFlagging(true);
    try {
      const bag = await bagService.flagSuspect(flagForm);
      toast.success(`Suspect bag flagged: ${bag.id} — go to Tagging Station`);
      setFlagModalOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to flag suspect bag");
    } finally {
      setFlagging(false);
    }
  }

  async function handleBatchFlag() {
    const count = Math.max(1, Math.min(20, batchCount));
    setFlagging(true);
    try {
      for (let index = 0; index < count; index += 1) {
        const input = createFlagForm(
          threatTypes[index % Math.max(1, threatTypes.length)] ?? "Suspect Bag",
        );
        await bagService.flagSuspect({
          ...input,
          flightNo: FLIGHTS[Math.floor(Math.random() * FLIGHTS.length)],
          iataOrigin: SIM_ORIGINS[index % SIM_ORIGINS.length],
        });
      }
      toast.success(`${count} suspect bags flagged — Tagging queue updated`);
      setFlagModalOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to batch flag bags");
    } finally {
      setFlagging(false);
    }
  }

  async function handleZoneRead(zone: string, readerId: string) {
    if (!selectedBag || !selectedBagCanRead) {
      toast.error("Tag this bag at Tagging Station first.");
      return;
    }
    try {
      await bagService.registerRead(selectedBag.id, zone, readerId);
      toast.info(`RFID read registered: ${selectedBag.id}`, {
        description: zone.replace(/_/g, " "),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Read failed");
    }
  }

  async function handleBurstReads() {
    if (!selectedBag?.epc || !selectedBagCanRead) {
      toast.error("Select a tagged bag first");
      return;
    }
    let merged = 0;
    for (let index = 0; index < 15; index += 1) {
      const result = await eventService.ingestRead(
        selectedBag.epc,
        "RDR-021",
        "CUSTOMS_EXIT_GATE_1",
      );
      if (result === "merged") merged += 1;
    }
    toast.info(`Burst: 15 reads → ${merged} merged, ${15 - merged} new`, {
      description: "Dedup engine working",
    });
  }

  async function handleForeignEpc() {
    const result = await eventService.ingestRead(
      "EPC-FOREIGN-999",
      "RDR-021",
      "CUSTOMS_EXIT_GATE_1",
    );
    toast.warning(`Foreign EPC result: ${result}`, {
      description: "Unregistered tag — read discarded, no alarm",
    });
  }

  function handleToggleReader(readerId: string) {
    const reader = readers.find((candidate) => candidate.id === readerId);
    if (!reader) return;
    const status = reader.status === "ONLINE" ? "OFFLINE" : "ONLINE";
    useAppStore.getState().updateReader(readerId, { status });
    toast.info(`${reader.name} → ${status}`);
  }

  async function handleAutoJourney(zones: readonly JourneyStop[]) {
    if (!selectedBag || !selectedBagCanRead) {
      toast.error("Select a tagged bag first");
      return;
    }
    setAutoRunning(true);
    try {
      for (const stop of zones) {
        await bagService.registerRead(selectedBag.id, stop.zone, stop.reader);
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      toast.success("Journey complete");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Journey stopped");
    } finally {
      setAutoRunning(false);
    }
  }

  function handleReset() {
    if (
      !window.confirm(
        "Reset all data? This will delete all bags, alarms, events, and resolutions. Readers will return to default state.",
      )
    ) {
      return;
    }
    useAppStore.getState().reset();
    eventService.clearCache();
    setSelectedBagId(null);
    flagCounter = 0;
    toast.info("System reset to seed state");
  }

  return (
    <RoleGate
      userRole={session.role}
      requiredRole="System Administrator"
      pageName="Simulator Panel"
    >
      <Dialog open={flagModalOpen} onOpenChange={setFlagModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Flag suspect bag</DialogTitle>
            <DialogDescription>
              Simulate the payload received from the SBTS/BHS adaptor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFlagBag} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FlagField label="Bag ID">
                <input
                  required
                  value={flagForm.id}
                  onChange={(event) =>
                    setFlagForm((current) => ({ ...current, id: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px]"
                />
              </FlagField>
              <FlagField label="BHS UID">
                <input
                  value={flagForm.bhsUid ?? ""}
                  onChange={(event) =>
                    setFlagForm((current) => ({ ...current, bhsUid: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px]"
                />
              </FlagField>
              <FlagField label="Flight number">
                <select
                  value={flagForm.flightNo}
                  onChange={(event) =>
                    setFlagForm((current) => ({ ...current, flightNo: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[12px]"
                >
                  {FLIGHTS.map((flight) => (
                    <option key={flight}>{flight}</option>
                  ))}
                </select>
              </FlagField>
              <FlagField label="IATA origin">
                <input
                  required
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  value={flagForm.iataOrigin ?? ""}
                  onChange={(event) =>
                    setFlagForm((current) => ({
                      ...current,
                      iataOrigin: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="RUH"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] uppercase"
                />
              </FlagField>
              <FlagField label="Passenger name">
                <input
                  value={flagForm.passengerName ?? ""}
                  onChange={(event) =>
                    setFlagForm((current) => ({
                      ...current,
                      passengerName: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[12px]"
                />
              </FlagField>
              <FlagField label="Threat type">
                <select
                  value={flagForm.threatType}
                  onChange={(event) =>
                    setFlagForm((current) => ({ ...current, threatType: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[12px]"
                >
                  {threatTypes.map((threatType) => (
                    <option key={threatType}>{threatType}</option>
                  ))}
                </select>
              </FlagField>
            </div>
            <FlagField label="Notes">
              <textarea
                rows={3}
                value={flagForm.notes ?? ""}
                onChange={(event) =>
                  setFlagForm((current) => ({ ...current, notes: event.target.value }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[12px]"
              />
            </FlagField>
            <DialogFooter>
              <button
                type="submit"
                disabled={flagging}
                className="rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                {flagging ? "Flagging…" : "Flag as Suspect"}
              </button>
            </DialogFooter>
          </form>
          <div className="border-t border-border pt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Batch flag
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={20}
                value={batchCount}
                onChange={(event) => setBatchCount(Number(event.target.value))}
                className="w-20 rounded-md border border-border bg-background px-3 py-2 text-[12px]"
              />
              <button
                type="button"
                disabled={flagging}
                onClick={() => void handleBatchFlag()}
                className="rounded-md border border-border px-3 py-2 text-[12px] font-medium hover:bg-accent disabled:opacity-50"
              >
                Flag {Math.max(1, Math.min(20, batchCount))} random bags
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="p-6">
        <PageHeader
          title="Simulator Panel"
          subtitle="Mock external systems — BHS flag, RFID reads, reader health"
          actions={
            <button
              type="button"
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
                Submit the adaptor payload, then tag the IDENTIFIED bag at Tagging Station.
              </p>
              <button
                type="button"
                onClick={openFlagModal}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-[13px] font-medium text-primary-foreground"
              >
                <Plus className="size-4" />
                Flag Suspect Bag
              </button>
            </Panel>

            <Panel title="Select Active Bag">
              {activeBags.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-muted-foreground">
                  {identifiedBags.length > 0
                    ? "Tag this bag at Tagging Station first."
                    : "No tagged bags — flag + encode one first"}
                </div>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {activeBags.map((bag) => (
                    <li key={bag.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedBagId(bag.id)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-[12px] ${
                          selectedBagId === bag.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-accent/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold">{bag.id}</span>
                          <StatusPill status="ACKNOWLEDGED" />
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          {bag.epc} · {(bag.lastSeenZone ?? "TAGGING_STATION").replace(/_/g, " ")}
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
                Simulate a reader detecting the selected bag at a zone.
                {!selectedBag && " Select a bag first."}
              </p>
              {selectedBag?.status === "IDENTIFIED" ? (
                <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                  Tag this bag at Tagging Station first.
                </div>
              ) : null}
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
                    type="button"
                    key={zone.zone}
                    onClick={() => void handleZoneRead(zone.zone, zone.reader)}
                    disabled={!selectedBagCanRead}
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
                Auto-move the selected bag through a journey. Each stop fires a read every 2
                seconds.
              </p>
              <div className="grid grid-cols-1 gap-2">
                <JourneyButton
                  onClick={() => void handleAutoJourney(JOURNEY_ZONES)}
                  disabled={!selectedBagCanRead || autoRunning}
                  className="bg-primary text-primary-foreground"
                >
                  Journey A — Reclaim → Hall → Exit (alarm)
                </JourneyButton>
                <JourneyButton
                  onClick={() => void handleAutoJourney(RESTRICTED_JOURNEY)}
                  disabled={!selectedBagCanRead || autoRunning}
                  className="bg-warning text-primary-foreground"
                >
                  Journey C — Reclaim → Employee Exit → Emergency Door
                </JourneyButton>
                <JourneyButton
                  onClick={() => void handleAutoJourney(FULL_CLEARED_JOURNEY)}
                  disabled={!selectedBagCanRead || autoRunning}
                  className="border border-primary text-primary"
                >
                  Journey Full — Reclaim → Exit → Recheck (alarm + ack needed)
                </JourneyButton>
                {autoRunning ? (
                  <div className="animate-pulse text-center text-[12px] text-muted-foreground">
                    Journey running...
                  </div>
                ) : null}
              </div>
            </Panel>
          </div>

          <div className="col-span-12 space-y-4 lg:col-span-4">
            <Panel title="Edge Case Tests">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void handleBurstReads()}
                  disabled={!selectedBagCanRead}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent disabled:opacity-30"
                >
                  <Zap className="size-3.5" />
                  Burst 15 reads (test dedup)
                </button>
                <button
                  type="button"
                  onClick={() => void handleForeignEpc()}
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
                  <li
                    key={reader.id}
                    className="flex items-center justify-between border-b border-border py-1.5 text-[12px] last:border-0"
                  >
                    <span className="flex-1 truncate">{reader.name}</span>
                    <button type="button" onClick={() => handleToggleReader(reader.id)}>
                      {reader.status === "ONLINE" ? (
                        <ToggleRight className="size-5 text-success" />
                      ) : (
                        <ToggleLeft className="size-5 text-muted-foreground" />
                      )}
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
                <dd className="font-mono font-semibold">
                  {bags.filter((bag) => !["RESOLVED", "IDENTIFIED"].includes(bag.status)).length}
                </dd>
                <dt className="text-muted-foreground">Open alarms</dt>
                <dd className="font-mono font-semibold text-danger">
                  {
                    alarms.filter((alarm) =>
                      ["OPEN", "UNDER_INVESTIGATION", "ESCALATED"].includes(alarm.outcome),
                    ).length
                  }
                </dd>
                <dt className="text-muted-foreground">Total events</dt>
                <dd className="font-mono font-semibold">{events.length}</dd>
                <dt className="text-muted-foreground">Readers online</dt>
                <dd className="font-mono font-semibold">
                  {readers.filter((reader) => reader.status === "ONLINE").length} / {readers.length}
                </dd>
              </dl>
            </Panel>
          </div>
        </div>
      </div>
    </RoleGate>
  );
}

function FlagField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] font-medium text-muted-foreground">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function JourneyButton({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-[13px] font-medium disabled:opacity-40 ${className ?? ""}`}
    >
      <Play className="size-4" />
      {children}
    </button>
  );
}
