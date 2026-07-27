import { createFileRoute } from "@tanstack/react-router";
import { Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { useSession } from "@/auth/SessionContext";
import { roleIsAtLeast } from "@/auth/canonicalRoles";
import { PageHeader, Panel, StatusPill } from "@/components/AppLayout";
import { MockBadge } from "@/components/MockBadge";
import { alarmService } from "@/services/alarmService";
import { bagService } from "@/services/bagService";
import { useAppStore } from "@/store/appStore";

export const Route = createFileRoute("/supervisor/overview")({
  head: () => ({ meta: [{ title: "Supervisor · BELTrak" }] }),
  component: SupervisorOverview,
});

function SupervisorOverview() {
  const session = useSession();
  const alarms = useAppStore((state) => state.alarms);
  const bags = useAppStore((state) => state.bags);
  const readers = useAppStore((state) => state.readers);
  const auditLog = useAppStore((state) => state.auditLog);
  const canMutate = roleIsAtLeast(session.role, "Customs Supervisor");
  const officerName = `${session.firstName} ${session.lastName}`.trim();

  const escalationQueue = alarms
    .filter((alarm) => alarm.outcome === "ESCALATED" || alarm.outcome === "OPEN")
    .sort(
      (first, second) =>
        new Date(second.triggeredAt).getTime() - new Date(first.triggeredAt).getTime(),
    );
  const unhealthyReaders = readers.filter((reader) => reader.status !== "ONLINE");
  const today = new Date().toDateString();
  const overridesToday = auditLog.filter(
    (entry) =>
      entry.action.toLowerCase().includes("override") &&
      new Date(entry.timestamp).toDateString() === today,
  );

  function runCanonicalAction(action: () => void) {
    if (!canMutate) {
      toast.error("Customs Supervisor role is required for this action.");
      return;
    }
    try {
      action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  }

  return (
    <RequireWorkspaceMode modes={["Supervisor"]}>
      <div className="p-6">
        <PageHeader
          title="Supervisor Overview"
          subtitle="Escalations, reader health, and operational overrides for the current shift."
        />

        {!canMutate ? (
          <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] text-warning">
            Read-only view. A canonical Customs Supervisor role is required to acknowledge, close,
            or reassign alarms.
          </div>
        ) : null}

        <div className="space-y-4">
          <Panel title="Escalation queue" action={<MockBadge />} className="overflow-hidden">
            <div className="-m-4 overflow-x-auto">
              <table className="w-full min-w-210 text-[12px]">
                <thead className="border-b border-border bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {["Alarm ID", "Bag", "Gate", "Severity", "Opened at", "Actions"].map(
                      (heading) => (
                        <th key={heading} className="px-4 py-2.5 text-left font-medium">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {escalationQueue.map((alarm) => {
                    const bag = bags.find((item) => item.id === alarm.bagId);
                    return (
                      <tr key={alarm.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-mono text-primary">{alarm.id}</td>
                        <td className="px-4 py-3 font-mono">{bag?.id ?? alarm.bagId}</td>
                        <td className="px-4 py-3">{alarm.zone.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3">
                          <span className="rounded border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                            HIGH
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          {new Date(alarm.triggeredAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={!canMutate || alarm.outcome !== "OPEN"}
                              onClick={() =>
                                runCanonicalAction(() =>
                                  alarmService.acknowledge(alarm.id, officerName),
                                )
                              }
                              className="inline-flex items-center gap-1 rounded border border-info/30 px-2 py-1 text-[10px] font-medium text-info disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Check className="size-3" />
                              Acknowledge
                            </button>
                            <button
                              type="button"
                              disabled={!canMutate}
                              onClick={() =>
                                void bagService
                                  .sendToRecheck(alarm.bagId, session.id)
                                  .catch((error) =>
                                    toast.error(
                                      error instanceof Error ? error.message : "Action failed",
                                    ),
                                  )
                              }
                              className="inline-flex items-center gap-1 rounded border border-success/30 px-2 py-1 text-[10px] font-medium text-success disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <X className="size-3" />
                              Send to recheck
                            </button>
                            <button
                              type="button"
                              disabled={!canMutate}
                              onClick={() =>
                                runCanonicalAction(() =>
                                  alarmService.reassign(alarm.id, officerName),
                                )
                              }
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <RotateCcw className="size-3" />
                              Reassign
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {escalationQueue.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        No escalated or high-priority alarms.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Reader health">
              <div className="mb-4 grid grid-cols-3 gap-2">
                {[
                  {
                    label: "Online",
                    value: readers.filter((reader) => reader.status === "ONLINE").length,
                    tone: "text-success",
                  },
                  {
                    label: "Degraded",
                    value: readers.filter((reader) => reader.status === "DEGRADED").length,
                    tone: "text-warning",
                  },
                  {
                    label: "Offline",
                    value: readers.filter((reader) => reader.status === "OFFLINE").length,
                    tone: "text-danger",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-md border border-border bg-background/40 p-3"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {item.label}
                    </div>
                    <div className={`mt-1 text-2xl font-semibold ${item.tone}`}>{item.value}</div>
                  </div>
                ))}
              </div>
              {unhealthyReaders.length > 0 ? (
                <ul className="divide-y divide-border">
                  {unhealthyReaders.map((reader) => (
                    <li
                      key={reader.id}
                      className="flex items-center justify-between gap-3 py-2.5 text-[12px]"
                    >
                      <span>
                        <span className="block font-medium">{reader.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {reader.id} · {reader.zone.replace(/_/g, " ")}
                        </span>
                      </span>
                      <StatusPill status={reader.status === "DEGRADED" ? "Degraded" : "Offline"} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-6 text-center text-[12px] text-muted-foreground">
                  All readers are online.
                </div>
              )}
            </Panel>

            <Panel title="Overrides today" action={<MockBadge />}>
              {overridesToday.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="pb-2 text-left font-medium">Time</th>
                        <th className="pb-2 text-left font-medium">Actor</th>
                        <th className="pb-2 text-left font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overridesToday.map((entry) => (
                        <tr key={entry.id} className="border-t border-border">
                          <td className="py-2.5 font-mono text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5">{entry.userName}</td>
                          <td className="py-2.5 font-mono">{entry.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-10 text-center text-[12px] text-muted-foreground">
                  No overrides recorded today.
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </RequireWorkspaceMode>
  );
}
