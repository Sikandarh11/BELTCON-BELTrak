import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search, Send, Tag } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { useSession } from "@/auth/SessionContext";
import { PageHeader, Panel, StatusPill } from "@/components/AppLayout";
import { MockBadge } from "@/components/MockBadge";
import { RoleGate } from "@/components/RoleGate";
import { bagService } from "@/services/bagService";
import { eventService } from "@/services/eventService";
import { useAppStore } from "@/store/appStore";

export const Route = createFileRoute("/ops/scan")({
  head: () => ({ meta: [{ title: "Operator Scan · BELTrak" }] }),
  component: OperatorScan,
});

function OperatorScan() {
  const session = useSession();
  const navigate = useNavigate();
  const bags = useAppStore((state) => state.bags);
  const alarms = useAppStore((state) => state.alarms);
  const events = useAppStore((state) => state.events);
  const [tagId, setTagId] = useState("");
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const selectedBag = selectedBagId ? (bags.find((bag) => bag.id === selectedBagId) ?? null) : null;
  const bagAlarms = selectedBag ? alarms.filter((alarm) => alarm.bagId === selectedBag.id) : [];
  const recentScans = events
    .filter(
      (event) => event.readerId === "OPS-SCAN" || event.eventType.toLowerCase().includes("scan"),
    )
    .sort(
      (first, second) => new Date(second.firstSeen).getTime() - new Date(first.firstSeen).getTime(),
    )
    .slice(0, 20);

  function handleScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTag = tagId.trim().toLowerCase();
    if (!normalizedTag) return;

    const bag = bags.find(
      (item) =>
        item.id.toLowerCase() === normalizedTag ||
        item.iataCode.toLowerCase() === normalizedTag ||
        item.epc?.toLowerCase() === normalizedTag,
    );

    setSearched(true);
    setSelectedBagId(bag?.id ?? null);

    if (!bag) return;
    if (bag.epc) {
      eventService.ingestRead(bag.epc, "OPS-SCAN", "OPERATIONS_SCAN");
    }
    toast.success(`Scanned ${bag.iataCode}`);
  }

  function sendToRecheck() {
    if (!selectedBag) return;
    try {
      bagService.sendToRecheck(selectedBag.id, session.id);
      void navigate({ to: "/recheck", search: { bagId: selectedBag.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to route bag to recheck");
    }
  }

  return (
    <RequireWorkspaceMode modes={["Operator"]}>
      <div className="p-6">
        <PageHeader
          title="Operator Scan"
          subtitle="Scan a baggage tag, confirm its current state, and route exceptions to recheck."
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <RoleGate
              userRole={session.role}
              requiredRole="Operations Officer"
              pageName="Operator scan actions"
            >
              <Panel title="Scan tag">
                <form onSubmit={handleScan} className="flex flex-col gap-2 sm:flex-row">
                  <label className="sr-only" htmlFor="operator-tag-id">
                    Tag ID
                  </label>
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="operator-tag-id"
                      autoFocus
                      value={tagId}
                      onChange={(event) => setTagId(event.target.value)}
                      placeholder="EPC-240091 or ETB-240091"
                      className="min-h-16 w-full rounded-lg border border-border bg-background pl-12 pr-4 font-mono text-xl tracking-wide outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex min-h-16 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground"
                  >
                    Scan
                    <ArrowRight className="size-4" />
                  </button>
                </form>
              </Panel>
            </RoleGate>

            {selectedBag ? (
              <Panel title="Bag found">
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-semibold">
                        {selectedBag.iataCode}
                      </span>
                      <StatusPill status={selectedBag.status} />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Bag ID</dt>
                        <dd className="mt-0.5 font-mono">{selectedBag.id}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Flight</dt>
                        <dd className="mt-0.5 font-mono">{selectedBag.flight}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Last seen</dt>
                        <dd className="mt-0.5">{selectedBag.currentZone.replace(/_/g, " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Alarms</dt>
                        <dd className="mt-0.5 font-mono">{bagAlarms.length}</dd>
                      </div>
                    </dl>
                    {bagAlarms.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {bagAlarms.map((alarm) => (
                          <span
                            key={alarm.id}
                            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
                          >
                            {alarm.id} · {alarm.outcome}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <RoleGate
                    userRole={session.role}
                    requiredRole="Operations Officer"
                    pageName="Send to recheck"
                  >
                    <button
                      type="button"
                      onClick={sendToRecheck}
                      className="inline-flex items-center justify-center gap-2 self-center rounded-md bg-warning px-4 py-2.5 text-[13px] font-semibold text-primary-foreground"
                    >
                      <Send className="size-4" />
                      Send to Recheck
                    </button>
                  </RoleGate>
                </div>
              </Panel>
            ) : searched ? (
              <Panel>
                <div className="flex flex-col items-center py-8 text-center">
                  <Tag className="size-8 text-muted-foreground" />
                  <div className="mt-3 text-sm font-semibold">Tag not registered</div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    No bag matched “{tagId.trim()}”.
                  </p>
                  <Link
                    to="/tagging"
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground"
                  >
                    Tag new bag
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </Panel>
            ) : null}

            <Panel title="Recent scans">
              {recentScans.length > 0 ? (
                <ul className="divide-y divide-border">
                  {recentScans.map((event) => {
                    const bag = bags.find((item) => item.epc === event.epc);
                    return (
                      <li key={event.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setTagId(event.epc);
                            setSelectedBagId(bag?.id ?? null);
                            setSearched(true);
                          }}
                          className="grid w-full grid-cols-[1fr_auto] gap-3 px-1 py-3 text-left hover:bg-accent/30"
                        >
                          <span>
                            <span className="block font-mono text-[12px]">{event.epc}</span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {event.zone.replace(/_/g, " ")}
                            </span>
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {new Date(event.firstSeen).toLocaleTimeString()}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="py-8 text-center text-[12px] text-muted-foreground">
                  No operator scans this shift.
                </div>
              )}
            </Panel>
          </div>

          <aside>
            <Panel title="Current shift" action={<MockBadge />}>
              <dl className="space-y-4 text-[12px]">
                <div>
                  <dt className="text-muted-foreground">Shift</dt>
                  <dd className="mt-1 font-medium">Morning · 06:00–14:00</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Officer</dt>
                  <dd className="mt-1 font-medium">
                    {session.firstName} {session.lastName}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Scans this shift</dt>
                  <dd className="mt-1 font-mono text-3xl font-semibold text-primary">
                    {recentScans.length}
                  </dd>
                </div>
              </dl>
            </Panel>
          </aside>
        </div>
      </div>
    </RequireWorkspaceMode>
  );
}
