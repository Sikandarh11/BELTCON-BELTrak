import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { useReducer, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";
import { hasPermission } from "@/auth/permissions";
import { PageHeader, Panel, StatusPill } from "@/components/AppLayout";
import { useEscalateAlarm } from "@/services/alarms/alarmClient";
import { XrayEmptyState } from "@/components/xray/XrayEmptyState";
import { XrayViewer } from "@/components/xray/XrayViewer";
import { RecheckStationAgentPanel } from "@/features/stations/RecheckStationAgentPanel";
import { scanForDisplay } from "@/services/xray/xrayScanSelection";
import { useRefreshXrayForBag, useXrayForBag, XrayApiError } from "@/services/xray/xrayClient";
import type { XrayScanSelection } from "@/types/xray";
import {
  useHbssRecall,
  useRecheckCase,
  useRecheckQueue,
  useResolveRecheckCase,
} from "@/services/recheck/recheckClient";
import { getHbssRecallPresentation, isHbssRecallStatus } from "@/services/recheck/hbssRecallStatus";

export const Route = createFileRoute("/recheck")({
  head: () => ({ meta: [{ title: "BELTCON Recheck Station" }] }),
  component: Recheck,
});
const scanSchema = z.object({
  tag: z
    .string()
    .trim()
    .min(1, "Scan an RFID label barcode or EPC")
    .max(256)
    .refine(
      (value) =>
        [...value].every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      "Scan contains control characters",
    ),
});
const resolutionSchema = z
  .object({
    disposition: z.enum(["CLEARED", "NOT_CLEARED"]),
    notes: z.string().trim().max(2_000).optional(),
    confirmed: z.boolean().refine((value) => value, "Confirm the final resolution"),
  })
  .superRefine((value, ctx) => {
    if (value.disposition === "NOT_CLEARED" && (!value.notes || value.notes.length < 3))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "Notes are required when marking a bag not cleared",
      });
  });
type Workflow =
  | "IDLE"
  | "LOADING_CASE"
  | "CASE_FOUND"
  | "CASE_NOT_FOUND"
  | "RECALLING_HBSS"
  | "RECALL_PENDING"
  | "RECALL_REQUEST_SENT"
  | "RECALL_SIMULATED"
  | "RECALL_UNAVAILABLE"
  | "RECALL_TIMED_OUT"
  | "RECALL_CANCELLED"
  | "RECALL_FAILED"
  | "RESOLVING"
  | "RESOLVED"
  | "ERROR";
type MessageTone = "info" | "success" | "warning" | "danger";
type State = { stage: Workflow; message: string | null; tone: MessageTone };
type Event = { type: Workflow; message?: string; tone?: MessageTone };
const reducer = (state: State, event: Event): State => ({
  stage: event.type,
  message: event.message ?? null,
  tone: event.tone ?? "info",
});
const key = () => crypto.randomUUID();
const EMPTY_XRAY_SELECTION: XrayScanSelection = { displayScan: null, latestAttempt: null };
function Recheck() {
  const user = useSession();
  const [selectedBag, setSelectedBag] = useState<string | null>(null);
  const [scanTag, setScanTag] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reducer, {
    stage: "IDLE",
    message: null,
    tone: "info",
  });
  const queue = useRecheckQueue({ page: 1, pageSize: 30 });
  const byBag = useRecheckCase(selectedBag);
  const byTag = useRecheckCase(scanTag);
  const current = scanTag ? byTag.data : byBag.data;
  const scan = useForm<z.infer<typeof scanSchema>>({
    resolver: zodResolver(scanSchema),
    defaultValues: { tag: "" },
  });
  const resolution = useForm<z.infer<typeof resolutionSchema>>({
    resolver: zodResolver(resolutionSchema),
    defaultValues: { disposition: "CLEARED", notes: "", confirmed: false },
  });
  const recall = useHbssRecall();
  const resolve = useResolveRecheckCase();
  const escalate = useEscalateAlarm();
  const caseData = current ?? null;
  const xrayViewSessionRef = useRef<string>(key());
  const xrayQuery = useXrayForBag(caseData?.bag.id ?? null, xrayViewSessionRef.current);
  const refreshXray = useRefreshXrayForBag();
  const canResolve = hasPermission(user.permissions, "bag.resolve");
  const canEscalate = hasPermission(user.permissions, "alarm.escalate");
  const xraySelection = xrayQuery.data ?? EMPTY_XRAY_SELECTION;
  const xrayScan = scanForDisplay(xraySelection);
  const xrayRefreshInFlightRef = useRef(false);
  const [xrayRefreshing, setXrayRefreshing] = useState(false);
  const pending = recall.isPending || resolve.isPending || escalate.isPending;
  const lookup = scan.handleSubmit((values) => {
    dispatch({ type: "LOADING_CASE" });
    setSelectedBag(null);
    setScanTag(values.tag.trim().toUpperCase());
  });
  const loadQueue = (bagId: string) => {
    setScanTag(null);
    setSelectedBag(bagId);
    dispatch({ type: "LOADING_CASE" });
  };
  if (byTag.isError && state.stage === "LOADING_CASE")
    dispatch({
      type: "CASE_NOT_FOUND",
      message: byTag.error instanceof Error ? byTag.error.message : "No active Recheck case found",
    });
  if ((byTag.data || byBag.data) && state.stage === "LOADING_CASE")
    dispatch({ type: "CASE_FOUND" });
  const requestRecall = async () => {
    if (!caseData) return;
    dispatch({ type: "RECALLING_HBSS" });
    try {
      const result = (await recall.mutateAsync({
        bagId: caseData.bag.id,
        input: {
          alarmId: caseData.alarm.id,
          expectedBagVersion: caseData.bag.version,
          expectedAlarmVersion: caseData.alarm.version,
          stationId: "RECHECK",
          idempotencyKey: key(),
        },
      })) as { recall?: { status?: string } };
      const returnedStatus = result.recall?.status;
      const status = isHbssRecallStatus(returnedStatus) ? returnedStatus : "FAILED";
      const presentation = getHbssRecallPresentation(status);
      dispatch({
        type: presentation.stage,
        message: presentation.message,
        tone: presentation.tone,
      });
    } catch (error) {
      dispatch({
        type: "RECALL_FAILED",
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "HBSS recall failed. Continue using the approved manual-inspection procedure.",
      });
    }
  };
  const finish = resolution.handleSubmit(async (values) => {
    if (!caseData) return;
    dispatch({ type: "RESOLVING" });
    try {
      await resolve.mutateAsync({
        bagId: caseData.bag.id,
        input: {
          alarmId: caseData.alarm.id,
          expectedBagVersion: caseData.bag.version,
          expectedAlarmVersion: caseData.alarm.version,
          disposition: values.disposition,
          notes: values.notes,
          idempotencyKey: key(),
        },
      });
      dispatch({
        type: "RESOLVED",
        message: `${values.disposition.replace("_", " ")} confirmed. The alarm is closed and the bag is resolved.`,
      });
      toast.success("Recheck case resolved");
    } catch (error) {
      dispatch({
        type: "ERROR",
        message: error instanceof Error ? error.message : "Resolution failed",
      });
    }
  });
  const doEscalate = async () => {
    if (!caseData || !canEscalate) return;
    const reason = window.prompt("Escalation reason (minimum 3 characters):")?.trim();
    if (!reason || reason.length < 3) return;
    try {
      await escalate.mutateAsync({
        alarmId: caseData.alarm.id,
        input: { expectedVersion: caseData.alarm.version, reason },
      });
      toast.success("Alarm escalated; the Recheck case remains active.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Escalation failed");
    }
  };
  const refreshFromHbss = async () => {
    if (!caseData || xrayRefreshInFlightRef.current) return;
    xrayRefreshInFlightRef.current = true;
    setXrayRefreshing(true);
    try {
      await refreshXray.mutateAsync({
        bagId: caseData.bag.id,
        viewSessionId: xrayViewSessionRef.current,
      });
      await xrayQuery.refetch();
    } finally {
      xrayRefreshInFlightRef.current = false;
      setXrayRefreshing(false);
    }
  };
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Recheck Station"
        subtitle="Authoritative manual inspection and HBSS recall workflow."
        actions={<StatusPill status={caseData ? "ACTIVE" : "CLOSED"} />}
      />
      <div className="grid grid-cols-12 gap-4">
        <Panel
          title="Recheck Queue"
          className="col-span-12 xl:col-span-4"
          action={
            <button
              type="button"
              onClick={() => void queue.refetch()}
              className="rounded border border-border p-1"
            >
              <RefreshCw className="size-4" />
            </button>
          }
        >
          {queue.isLoading ? (
            <p className="py-8 text-sm text-muted-foreground">Loading queue…</p>
          ) : queue.isError ? (
            <button type="button" onClick={() => void queue.refetch()} className="text-danger">
              Retry loading Recheck queue
            </button>
          ) : (queue.data?.items.length ?? 0) === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">No active Recheck cases.</p>
          ) : (
            <div className="space-y-2">
              {queue.data?.items.map((item) => (
                <button
                  type="button"
                  key={item.alarmId}
                  onClick={() => loadQueue(item.bagId)}
                  className={`w-full rounded border p-3 text-left hover:bg-accent ${selectedBag === item.bagId ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="flex justify-between">
                    <span className="font-mono text-xs">{item.bhsUid}</span>
                    <StatusPill status={item.alarmStatus} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.rfidTagBarcode ?? item.epc ?? "No tag"} · {item.alarmSeverity}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
        <div className="col-span-12 space-y-4 xl:col-span-8">
          <Panel title="Scan RFID Tag">
            <form onSubmit={lookup} className="flex gap-2">
              <input
                autoFocus
                {...scan.register("tag")}
                placeholder="RFID Tag Barcode or EPC"
                disabled={byTag.isFetching}
                className="h-11 flex-1 rounded border border-border bg-background px-3 font-mono"
              />
              <button
                type="submit"
                disabled={byTag.isFetching}
                className="inline-flex items-center gap-1 rounded bg-primary px-3 text-primary-foreground disabled:opacity-50"
              >
                <Search className="size-4" />
                Lookup
              </button>
              <button
                type="button"
                onClick={() => {
                  scan.reset();
                  setScanTag(null);
                  setSelectedBag(null);
                  dispatch({ type: "IDLE" });
                }}
                className="rounded border border-border px-3"
              >
                Reset
              </button>
            </form>
            {scan.formState.errors.tag ? (
              <p className="mt-2 text-xs text-danger">{scan.formState.errors.tag.message}</p>
            ) : null}
          </Panel>
          {state.message ? (
            <div
              role="status"
              className={`rounded border p-3 text-sm ${
                state.tone === "danger"
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : state.tone === "warning"
                    ? "border-warning/30 bg-warning/10 text-warning"
                    : state.tone === "success"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-info/30 bg-info/10 text-info"
              }`}
            >
              {state.message}
            </div>
          ) : null}
          {caseData ? (
            <>
              <Panel title="Case Details">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt>BHS BagID</dt>
                  <dd className="font-mono">{caseData.bag.bhsUid}</dd>
                  <dt>Bag ID</dt>
                  <dd className="font-mono">{caseData.bag.id}</dd>
                  <dt>RFID label</dt>
                  <dd>{caseData.bag.rfidTagBarcode ?? "—"}</dd>
                  <dt>EPC</dt>
                  <dd className="font-mono">{caseData.bag.epc ?? "—"}</dd>
                  <dt>Screening</dt>
                  <dd>{caseData.bag.screeningEvaluation ?? "—"}</dd>
                  <dt>Alarm</dt>
                  <dd>
                    <StatusPill status={caseData.alarm.status} />
                  </dd>
                  <dt>Bag state</dt>
                  <dd>{caseData.bag.status}</dd>
                </dl>
              </Panel>
              <Panel title="HBSS Recall">
                <p className="mb-3 text-sm text-muted-foreground">
                  Latest request: {caseData.recall.latestStatus ?? "Not requested"}
                </p>
                <button
                  type="button"
                  onClick={() => void requestRecall()}
                  disabled={pending}
                  className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                  Recall X-ray from HBSS
                </button>
              </Panel>
              <RecheckStationAgentPanel barcode={scanTag ?? caseData.bag.rfidTagBarcode} />
              <Panel
                title="X-ray scan"
                action={
                  <button
                    type="button"
                    onClick={() => void refreshFromHbss()}
                    disabled={xrayRefreshing}
                    className="rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    {xrayRefreshing ? "Refreshing…" : "Refresh from HBSS"}
                  </button>
                }
              >
                {xrayQuery.isError || refreshXray.isError ? (
                  <div className="space-y-3">
                    <div className="rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                      {refreshXray.error instanceof XrayApiError &&
                      refreshXray.error.code === "HBSS_REQUEST_TIMED_OUT"
                        ? "HBSS X-ray refresh timed out. No new image was accepted. "
                        : "Latest HBSS refresh failed. "}
                      {xraySelection.displayScan
                        ? "Displaying the last available scan."
                        : "Manual inspection remains available."}
                    </div>
                    {xraySelection.displayScan ? (
                      <XrayViewer bagId={caseData.bag.id} scan={xraySelection.displayScan} />
                    ) : (
                      <XrayEmptyState kind="error" showManualInspectionWarning />
                    )}
                  </div>
                ) : xrayQuery.isLoading ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Loading X-ray scan…
                  </p>
                ) : xrayScan?.status === "AVAILABLE" && xrayScan.images.length > 0 ? (
                  <XrayViewer bagId={caseData.bag.id} scan={xrayScan} />
                ) : (
                  <XrayEmptyState
                    kind={
                      !caseData.bag.bhsUid
                        ? "no-bhs-uid"
                        : xrayScan?.status === "PENDING"
                          ? "pending"
                          : xrayScan?.status === "NOT_FOUND"
                            ? "missing"
                            : xrayScan?.status === "FAILED"
                              ? "failed"
                              : xrayScan?.status === "ARCHIVED"
                                ? "archived"
                                : "not-requested"
                    }
                    showManualInspectionWarning
                  />
                )}
              </Panel>
              <Panel title="Manual Inspection">
                <form onSubmit={finish} className="space-y-3">
                  <label className="block text-sm">
                    Disposition
                    <select
                      {...resolution.register("disposition")}
                      className="mt-1 h-10 w-full rounded border border-border bg-background px-2"
                    >
                      <option value="CLEARED">Clear Bag</option>
                      <option value="NOT_CLEARED">Mark Not Cleared</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    Inspection notes
                    <textarea
                      {...resolution.register("notes")}
                      className="mt-1 min-h-22 w-full rounded border border-border bg-background p-2"
                    />
                  </label>
                  <label className="flex gap-2 text-sm">
                    <input type="checkbox" {...resolution.register("confirmed")} />
                    This action will close the active alarm and mark the bag as resolved.
                  </label>
                  {resolution.formState.errors.notes ? (
                    <p className="text-xs text-danger">
                      {resolution.formState.errors.notes.message}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={pending || !canResolve}
                      className="inline-flex items-center gap-1 rounded bg-success px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                    >
                      <CheckCircle2 className="size-4" />
                      Confirm final resolution
                    </button>
                    <button
                      type="button"
                      onClick={() => void doEscalate()}
                      disabled={pending || !canEscalate}
                      className="inline-flex items-center gap-1 rounded border border-warning px-3 py-2 text-sm text-warning disabled:opacity-50"
                    >
                      <ShieldAlert className="size-4" />
                      Escalate
                    </button>
                  </div>
                  {!canResolve ? (
                    <p className="text-xs text-muted-foreground">
                      Your account can inspect this case but does not have permission to record a
                      final resolution.
                    </p>
                  ) : null}
                </form>
              </Panel>
              <Panel title="Authoritative Timeline">
                <ol className="space-y-2 text-sm">
                  {caseData.actions.map((item) => (
                    <li key={item.id}>
                      <strong>{item.type.replace(/_/g, " ")}</strong>
                      <span className="ml-2 text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                      {item.detail ? <span className="ml-2">{item.detail}</span> : null}
                    </li>
                  ))}
                </ol>
              </Panel>
            </>
          ) : (
            <Panel title="Case Details">
              <p className="py-10 text-center text-sm text-muted-foreground">
                Scan an RFID label or select a case from the authoritative queue.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
