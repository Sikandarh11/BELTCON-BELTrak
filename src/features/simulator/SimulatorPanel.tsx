import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Ghost,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ToggleLeft,
  ToggleRight,
  Zap,
} from "lucide-react";

import { useSession } from "@/auth/SessionContext";
import { Panel, PageHeader } from "@/components/AppLayout";
import { RoleGate } from "@/components/RoleGate";
import { bagService } from "@/services/bagService";
import {
  fetchRfidTrackableBags,
  RFID_TRACKABLE_BAGS_QUERY_KEY,
} from "@/services/bags/rfidTrackableClient";
import { eventService } from "@/services/eventService";
import { useAppStore } from "@/store/appStore";
import { isRfidMovementStatus, matchesRfidBagSearch } from "@/types/rfid";

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

export function SimulatorPanel() {
  const session = useSession();
  const queryClient = useQueryClient();
  const bags = useAppStore((state) => state.bags);
  const alarms = useAppStore((state) => state.alarms);
  const events = useAppStore((state) => state.events);
  const readers = useAppStore((state) => state.readers);
  const mergeBagsFromServer = useAppStore((state) => state.mergeBagsFromServer);
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [bagSearch, setBagSearch] = useState("");
  const [autoRunning, setAutoRunning] = useState(false);

  const activeBagsQuery = useQuery({
    queryKey: RFID_TRACKABLE_BAGS_QUERY_KEY,
    queryFn: fetchRfidTrackableBags,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const activeBags = useMemo(() => activeBagsQuery.data ?? [], [activeBagsQuery.data]);
  const filteredActiveBags = activeBags.filter((bag) => matchesRfidBagSearch(bag, bagSearch));
  const selectedBag = selectedBagId
    ? (activeBags.find((bag) => bag.id === selectedBagId) ?? null)
    : null;
  const selectedBagCanRead = Boolean(selectedBag?.epc && isRfidMovementStatus(selectedBag.status));

  useEffect(() => {
    if (activeBags.length > 0) {
      mergeBagsFromServer(activeBags);
    }
  }, [activeBags, mergeBagsFromServer]);

  useEffect(() => {
    if (selectedBagId && activeBagsQuery.data && !selectedBag) {
      setSelectedBagId(null);
    }
  }, [activeBagsQuery.data, selectedBag, selectedBagId]);

  async function refreshActiveBags() {
    await queryClient.invalidateQueries({
      queryKey: RFID_TRACKABLE_BAGS_QUERY_KEY,
      refetchType: "active",
    });
  }

  async function handleZoneRead(zone: string, readerId: string) {
    if (!selectedBag || !selectedBagCanRead) {
      toast.error("Tag this bag at Tagging Station first.");
      return;
    }
    try {
      await bagService.registerRead(selectedBag.id, zone, readerId);
      await refreshActiveBags();
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
    await refreshActiveBags();
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
        await refreshActiveBags();
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      await activeBagsQuery.refetch();
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
        "Reset to seed? This replaces/deletes demo operational bags, alarms, events, and resolutions in the configured database. Readers return to their default state.",
      )
    ) {
      return;
    }
    useAppStore.getState().reset();
    eventService.clearCache();
    setSelectedBagId(null);
    void refreshActiveBags();
    toast.info("System reset to seed state");
  }

  return (
    <RoleGate
      userRole={session.role}
      requiredRole="System Administrator"
      pageName="Simulator Panel"
    >
      <div className="p-6">
        <PageHeader
          title="RFID Journey Simulator"
          subtitle="RFID reads, journeys, burst tests, foreign EPCs, and reader health"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void activeBagsQuery.refetch()}
                disabled={activeBagsQuery.isFetching}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-accent disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-3.5 ${activeBagsQuery.isFetching ? "animate-spin" : ""}`}
                />
                Refresh bags
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-accent"
              >
                <RotateCcw className="size-3.5" />
                Reset to seed
              </button>
            </div>
          }
        />

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 space-y-4 lg:col-span-3">
            <Panel title="Select Active Bag">
              <label className="relative mb-3 block">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <span className="sr-only">Search RFID-trackable bags</span>
                <input
                  type="search"
                  value={bagSearch}
                  onChange={(event) => setBagSearch(event.target.value)}
                  placeholder="Bag ID, BHS UID, or EPC"
                  className="w-full rounded-md border border-border bg-background py-2 pr-3 pl-9 text-[12px] outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>

              {activeBagsQuery.isLoading ? (
                <div className="py-4 text-center text-[12px] text-muted-foreground">
                  Loading RFID-trackable bags...
                </div>
              ) : activeBagsQuery.isError ? (
                <div
                  role="alert"
                  className="rounded-md border border-danger/30 bg-danger/10 p-3 text-[12px] text-danger"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="size-4" />
                    Unable to load active bags
                  </div>
                  <p className="mt-1">
                    {activeBagsQuery.error instanceof Error
                      ? activeBagsQuery.error.message
                      : "RFID bag query failed"}
                  </p>
                </div>
              ) : filteredActiveBags.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-muted-foreground">
                  {activeBags.length > 0
                    ? "No bags match this search."
                    : "No RFID-trackable bags. Encode a tag at Tagging Station first."}
                </div>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {filteredActiveBags.map((bag) => (
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
                          <span className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[9px] text-primary">
                            {bag.status}
                          </span>
                        </div>
                        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                          <dt>BHS</dt>
                          <dd className="truncate font-mono">{bag.bhsUid ?? "Not supplied"}</dd>
                          <dt>EPC</dt>
                          <dd className="truncate font-mono">{bag.epc}</dd>
                          <dt>Zone</dt>
                          <dd>{(bag.lastSeenZone ?? "TAGGING_STATION").replace(/_/g, " ")}</dd>
                          <dt>Flight</dt>
                          <dd className="font-mono">{bag.flightNo}</dd>
                        </dl>
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
