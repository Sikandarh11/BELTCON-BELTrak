import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronLeft, ChevronRight, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useSession } from "@/auth/SessionContext";
import { PageHeader, Panel, StatusPill } from "@/components/AppLayout";
import {
  useAcknowledgeAlarm,
  useAlarm,
  useAlarms,
  useEscalateAlarm,
  useSendToRecheck,
} from "@/services/alarms/alarmClient";
import { AppApiError } from "@/services/api/appApiError";
import {
  ACTIVE_ALARM_WORKFLOW_STATUSES,
  type AlarmListFilters,
  type AlarmWorkflowStatus,
} from "@/services/alarms/alarmSchemas";

export const Route = createFileRoute("/alarms")({
  head: () => ({ meta: [{ title: "Notifications & Alarms · BELTCON SBTS" }] }),
  component: Alarms,
});

const DEFAULT_STATUSES = [...ACTIVE_ALARM_WORKFLOW_STATUSES];
type Action = "acknowledge" | "escalate" | "sendToRecheck";

function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Alarm action failed";
}

function Alarms() {
  const user = useSession();
  const [statuses, setStatuses] = useState<AlarmWorkflowStatus[]>(DEFAULT_STATUSES);
  const [severity, setSeverity] = useState<"" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedAlarmId, setSelectedAlarmId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const filters = useMemo<AlarmListFilters>(
    () => ({
      page,
      pageSize: 25,
      statuses,
      ...(severity ? { severity } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    [page, search, severity, statuses],
  );
  const listQuery = useAlarms(filters);
  const detailQuery = useAlarm(selectedAlarmId);
  const acknowledge = useAcknowledgeAlarm();
  const escalate = useEscalateAlarm();
  const sendToRecheck = useSendToRecheck();
  const selected = detailQuery.data;
  const canAcknowledge = user.permissions.includes("alarm.acknowledge");
  const canEscalate = user.permissions.includes("alarm.escalate");
  const canRecheck = user.permissions.includes("bag.recheck");
  const pending = acknowledge.isPending || escalate.isPending || sendToRecheck.isPending;
  const totalPages = Math.max(1, Math.ceil((listQuery.data?.total ?? 0) / filters.pageSize));

  const toggleStatus = (status: AlarmWorkflowStatus) => {
    setPage(1);
    setStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  };

  const closeAction = () => {
    if (pending) return;
    setAction(null);
    setReason("");
    setNotes("");
  };

  const refetchAfterConflict = async () => {
    await Promise.all([listQuery.refetch(), detailQuery.refetch()]);
    toast.error("This alarm was changed by another user. The latest data has been loaded.");
  };

  const submitAction = async () => {
    if (!selected || !action) return;
    if ((action === "escalate" || action === "sendToRecheck") && reason.trim().length < 3) {
      toast.error("Provide a reason of at least 3 characters.");
      return;
    }
    try {
      if (action === "acknowledge") {
        await acknowledge.mutateAsync({
          alarmId: selected.id,
          input: {
            expectedVersion: selected.version,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        });
        toast.success("Alarm acknowledged.");
      } else if (action === "escalate") {
        await escalate.mutateAsync({
          alarmId: selected.id,
          input: {
            expectedVersion: selected.version,
            reason: reason.trim(),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        });
        toast.success("Alarm escalated.");
      } else {
        await sendToRecheck.mutateAsync({
          alarmId: selected.id,
          input: { expectedVersion: selected.version, reason: reason.trim() },
        });
        toast.success("Bag sent to Recheck.");
      }
      closeAction();
    } catch (error) {
      if (error instanceof AppApiError && error.code === "ALARM_VERSION_CONFLICT") {
        await refetchAfterConflict();
      } else {
        toast.error(errorMessage(error));
      }
    }
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Notifications & Alarms"
        subtitle="BELTCON Customs Exit Workflow — server-backed operational alarms."
        actions={
          <button
            type="button"
            onClick={() => void Promise.all([listQuery.refetch(), detailQuery.refetch()])}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm"
          >
            <RefreshCw className="size-4" /> Refresh
          </button>
        }
      />
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Filters" className="col-span-12 lg:col-span-3">
          <div className="space-y-4 text-sm">
            <fieldset>
              <legend className="mb-2 text-xs text-muted-foreground">Workflow status</legend>
              {[...DEFAULT_STATUSES, "CLOSED" as const].map((status) => (
                <label key={status} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={statuses.includes(status)}
                    onChange={() => toggleStatus(status)}
                    className="accent-primary"
                  />
                  {status.replace(/_/g, " ")}
                </label>
              ))}
            </fieldset>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Severity</span>
              <select
                value={severity}
                onChange={(event) => {
                  setPage(1);
                  setSeverity(event.target.value as typeof severity);
                }}
                className="h-9 w-full rounded border border-border bg-background px-2"
              >
                <option value="">All severities</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">BHS BagID or EPC</span>
              <input
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="Search BHS BagID or EPC"
                className="h-9 w-full rounded border border-border bg-background px-2"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setStatuses(DEFAULT_STATUSES);
                setSeverity("");
                setSearch("");
                setPage(1);
              }}
              className="w-full rounded border border-border px-3 py-2 text-xs hover:bg-accent"
            >
              Reset filters
            </button>
          </div>
        </Panel>

        <Panel title="Alarm queue" className="col-span-12 lg:col-span-5 !p-0">
          {listQuery.isLoading ? (
            <div className="space-y-2 p-4" aria-label="Loading alarms">
              {[1, 2, 3, 4, 5].map((item) => (
                <div key={item} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <div className="p-8 text-center text-sm">
              <p role="alert" className="text-danger">
                {errorMessage(listQuery.error)}
              </p>
              <button
                type="button"
                onClick={() => void listQuery.refetch()}
                className="mt-3 rounded border border-border px-3 py-2"
              >
                Retry
              </button>
            </div>
          ) : (listQuery.data?.alarms.length ?? 0) === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              No active alarms match the selected filters.
            </p>
          ) : (
            <>
              <div className="max-h-[640px] overflow-auto">
                {(listQuery.data?.alarms ?? []).map((alarm) => (
                  <button
                    type="button"
                    key={alarm.id}
                    onClick={() => {
                      setSelectedAlarmId(alarm.id);
                      setAction(null);
                    }}
                    className={`w-full border-b border-border p-3 text-left hover:bg-accent/40 ${selectedAlarmId === alarm.id ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs text-primary">{alarm.id}</span>
                      <StatusPill status={alarm.status} />
                    </div>
                    <div className="mt-1 text-sm font-medium">{alarm.bhsUid ?? alarm.bagId}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{alarm.zone.replace(/_/g, " ")}</span>
                      <span>{alarm.epc ?? "No EPC"}</span>
                      <span>{date(alarm.openedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
                <span>
                  Page {filters.page} of {totalPages} · {listQuery.data?.total ?? 0} alarms
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="rounded border border-border p-1 disabled:opacity-40"
                    aria-label="Previous alarms page"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    className="rounded border border-border p-1 disabled:opacity-40"
                    aria-label="Next alarms page"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Alarm detail" className="col-span-12 lg:col-span-4">
          {!selectedAlarmId ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Select an alarm to inspect it.
            </p>
          ) : detailQuery.isLoading ? (
            <div className="space-y-2 py-4" aria-label="Loading alarm detail">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-6 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : detailQuery.isError ? (
            <div className="py-12 text-center text-sm">
              <p role="alert" className="text-danger">
                {errorMessage(detailQuery.error)}
              </p>
              <button
                type="button"
                onClick={() => void detailQuery.refetch()}
                className="mt-3 rounded border border-border px-3 py-2"
              >
                Retry
              </button>
            </div>
          ) : selected ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                <dt className="text-muted-foreground">Alarm</dt>
                <dd className="font-mono">{selected.id}</dd>
                <dt className="text-muted-foreground">BHS BagID</dt>
                <dd>{selected.bhsUid ?? "Not supplied"}</dd>
                <dt className="text-muted-foreground">RFID EPC</dt>
                <dd className="font-mono">{selected.epc ?? "—"}</dd>
                <dt className="text-muted-foreground">Label barcode</dt>
                <dd>{selected.rfidTagBarcode ?? "—"}</dd>
                <dt className="text-muted-foreground">Screening</dt>
                <dd>{selected.screeningEvaluation ?? "—"}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd>
                  {selected.zone.replace(/_/g, " ")}
                  {selected.readerId
                    ? ` · ${selected.readerId}/${selected.antennaPort ?? "?"}`
                    : ""}
                </dd>
                <dt className="text-muted-foreground">Severity</dt>
                <dd>{selected.severity}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusPill status={selected.status} />
                </dd>
                <dt className="text-muted-foreground">Bag lifecycle</dt>
                <dd>{selected.currentBagStatus ?? "—"}</dd>
                <dt className="text-muted-foreground">Opened</dt>
                <dd>{date(selected.openedAt)}</dd>
                <dt className="text-muted-foreground">Acknowledged</dt>
                <dd>{date(selected.acknowledgedAt)}</dd>
                <dt className="text-muted-foreground">Escalated</dt>
                <dd>{date(selected.escalatedAt)}</dd>
                <dt className="text-muted-foreground">Sent to Recheck</dt>
                <dd>{date(selected.sentToRecheckAt)}</dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {selected.status === "OPEN" && canAcknowledge ? (
                  <button
                    type="button"
                    onClick={() => setAction("acknowledge")}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded bg-info px-2.5 py-1.5 text-xs text-info-foreground disabled:opacity-50"
                  >
                    <Check className="size-3.5" /> Acknowledge
                  </button>
                ) : null}
                {["OPEN", "ACKNOWLEDGED"].includes(selected.status) && canEscalate ? (
                  <button
                    type="button"
                    onClick={() => setAction("escalate")}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded border border-warning/40 px-2.5 py-1.5 text-xs text-warning disabled:opacity-50"
                  >
                    <ShieldAlert className="size-3.5" /> Escalate
                  </button>
                ) : null}
                {["OPEN", "ACKNOWLEDGED", "ESCALATED"].includes(selected.status) && canRecheck ? (
                  <button
                    type="button"
                    onClick={() => setAction("sendToRecheck")}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded border border-primary/40 px-2.5 py-1.5 text-xs text-primary disabled:opacity-50"
                  >
                    <Send className="size-3.5" /> Send to Recheck
                  </button>
                ) : null}
              </div>
              {action ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAction();
                  }}
                  className="mt-4 rounded border border-primary/30 bg-primary/5 p-3"
                >
                  <div className="mb-2 text-sm font-medium">
                    Confirm {action === "sendToRecheck" ? "send to Recheck" : action}
                  </div>
                  {action !== "acknowledge" ? (
                    <label className="block text-xs">
                      Reason
                      <textarea
                        required
                        minLength={3}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        className="mt-1 min-h-16 w-full rounded border border-border bg-background p-2"
                      />
                    </label>
                  ) : null}
                  {action !== "sendToRecheck" ? (
                    <label className="mt-2 block text-xs">
                      Notes (optional)
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        className="mt-1 min-h-14 w-full rounded border border-border bg-background p-2"
                      />
                    </label>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {pending ? "Saving…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={closeAction}
                      disabled={pending}
                      className="rounded border border-border px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              <div className="mt-5 border-t border-border pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Action history
                </h3>
                {selected.actions.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No workflow actions recorded.
                  </p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {selected.actions.map((item) => (
                      <li key={item.id} className="border-l-2 border-border pl-2 text-xs">
                        <div className="font-medium">{item.action.replace(/_/g, " ")}</div>
                        <div className="text-muted-foreground">
                          {date(item.createdAt)} · {item.actorId ?? "System"}
                        </div>
                        {item.reason ? <div className="mt-0.5">Reason: {item.reason}</div> : null}
                        {item.notes ? <div className="mt-0.5">Notes: {item.notes}</div> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
