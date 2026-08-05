import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  RefreshCw,
  RotateCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { Panel } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionMaybe } from "@/auth/SessionContext";
import { auditKeys, bagKeys, taggingKeys } from "@/lib/queryKeys";
import { RFID_TRACKABLE_BAGS_QUERY_KEY } from "@/services/bags/rfidTrackableClient";

type QueueItem = {
  id: string;
  bhsUid: string;
  lineId: string;
  evaluation: string;
  state: string;
  synchronizationStatus: string;
  receivedAt: string;
  centralTaggingSessionId: string | null;
};
type WorkflowSession = {
  id: string;
  bagId: string;
  bhsUid: string;
  state: string;
  provisioningMode: "PRE_ENCODED_TAG" | "PRINT_AND_ENCODE";
  rfidTagBarcode: string | null;
  expectedEpc: string | null;
  verifiedEpc: string | null;
  iataLpc: string | null;
  photoPolicy: "REQUIRED" | "OPTIONAL" | "DISABLED";
  photoStatus: string;
  failureCode: string | null;
  version: number;
  simulated: boolean;
};
type StationView = {
  health: {
    state: string;
    pendingAcknowledgements: number;
    pendingSynchronizations: number;
    detail?: string;
  };
  queue: {
    position1: QueueItem | null;
    position2: QueueItem | null;
    alarms: Array<{ id: string; code: string; detail: string }>;
  };
  simulation: boolean;
  devices: Record<string, { state: string; code: string | null; simulated: boolean }>;
  workflow: { status: string; session?: WorkflowSession } | null;
};

async function readResponse(response: Response) {
  const body = (await response.json()) as StationView & { error?: string; code?: string };
  if (!response.ok) throw new Error(body.code ?? body.error ?? "Station agent is unavailable");
  return body;
}

function mutationId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function TaggingStationAgentPanel() {
  const user = useSessionMaybe();
  const queryClient = useQueryClient();
  const [view, setView] = useState<StationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [epc, setEpc] = useState("");
  const [iataLpc, setIataLpc] = useState("");
  const [photoOverrideReason, setPhotoOverrideReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/stations/tagging", { credentials: "include" });
      setView(await readResponse(response));
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Station agent is unavailable",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const activeBagKey = view?.queue.position1
    ? `${view.queue.position1.id}:${view.queue.position1.bhsUid}`
    : null;
  useEffect(() => {
    setBarcode("");
    setEpc("");
    setIataLpc("");
    setPhotoOverrideReason("");
  }, [activeBagKey]);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/stations/tagging", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setView(await readResponse(response));
      if (body.action === "COMMIT") {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: RFID_TRACKABLE_BAGS_QUERY_KEY,
            refetchType: "all",
          }),
          queryClient.invalidateQueries({ queryKey: taggingKeys.all, refetchType: "all" }),
          queryClient.invalidateQueries({ queryKey: bagKeys.all, refetchType: "all" }),
          queryClient.invalidateQueries({ queryKey: auditKeys.all, refetchType: "all" }),
        ]);
      }
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Station action failed");
    } finally {
      setBusy(false);
    }
  }

  const online = view?.health.state === "ONLINE";
  const active = view?.queue.position1 ?? null;
  const waiting = view?.queue.position2 ?? null;
  const session = view?.workflow?.session ?? null;
  const assignmentBlocked = !online || (view?.health.pendingSynchronizations ?? 0) > 0;
  return (
    <Panel title="Tagging Station" className="mb-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${online ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
        >
          {online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {view?.health.state ?? "OFFLINE"}
        </span>
        {view?.simulation || session?.simulated ? (
          <span className="rounded-full bg-info/10 px-2 py-1 font-semibold text-info">
            SOFTWARE SIMULATION
          </span>
        ) : null}
        {active && waiting ? (
          <span className="rounded-full bg-danger/10 px-2 py-1 font-semibold text-danger">
            QUEUE FULL
          </span>
        ) : null}
        {assignmentBlocked ? (
          <span className="rounded-full bg-warning/10 px-2 py-1 font-semibold text-warning">
            OFFLINE — TAG ASSIGNMENT BLOCKED
          </span>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCw /> Refresh
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || (view?.health.pendingSynchronizations ?? 0) === 0}
          onClick={() => void action({ action: "RETRY_SYNCHRONIZATION" })}
        >
          <RotateCw /> Retry sync
        </Button>
      </div>

      {error ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="size-4" /> {error}. The central tagging record remains
          authoritative.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <PositionCard label="POSITION 1 · ACTIVE TAGGING" item={active} />
        <PositionCard label="POSITION 2 · WAITING" item={waiting} />
      </div>

      {active && !session ? (
        <div className="mt-4 rounded-md border border-border p-4">
          <Button
            type="button"
            disabled={busy || assignmentBlocked || active.state === "JAMMED"}
            onClick={() =>
              void action({
                action: "START_SESSION",
                queueItemId: active.id,
                requestId: mutationId("start"),
              })
            }
          >
            Start server-controlled tagging
          </Button>
        </div>
      ) : null}

      {active && session ? (
        <WorkflowPanel
          session={session}
          active={active}
          barcode={barcode}
          epc={epc}
          iataLpc={iataLpc}
          busy={busy || assignmentBlocked}
          setBarcode={setBarcode}
          setEpc={setEpc}
          setIataLpc={setIataLpc}
          photoOverrideReason={photoOverrideReason}
          setPhotoOverrideReason={setPhotoOverrideReason}
          canOverridePhoto={Boolean(user?.permissions.includes("tagging.override.photo"))}
          action={action}
        />
      ) : null}

      {(view?.queue.alarms.length ?? 0) > 0 ? (
        <div className="mt-3 space-y-1 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          {view?.queue.alarms.map((alarm) => (
            <p key={alarm.id}>
              <strong>{alarm.code}</strong> · {alarm.detail}
            </p>
          ))}
        </div>
      ) : null}
      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(view?.devices ?? {}).map(([name, health]) => (
          <div key={name} className="rounded border border-border p-2">
            <strong>{name}</strong>
            <p>
              {health.state}
              {health.code ? ` · ${health.code}` : ""}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PositionCard({ label, item }: { label: string; item: QueueItem | null }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground">{label}</p>
      {!item ? (
        <p className="mt-3 text-sm text-muted-foreground">Empty</p>
      ) : (
        <>
          <p className="mt-2 font-mono text-lg font-semibold">{item.bhsUid}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Evaluation</dt>
            <dd>{item.evaluation}</dd>
            <dt className="text-muted-foreground">LineID</dt>
            <dd>{item.lineId}</dd>
            <dt className="text-muted-foreground">State</dt>
            <dd>{item.state}</dd>
            <dt className="text-muted-foreground">Synchronization</dt>
            <dd>{item.synchronizationStatus}</dd>
            <dt className="text-muted-foreground">Received</dt>
            <dd>{item.receivedAt}</dd>
          </dl>
        </>
      )}
    </div>
  );
}

function WorkflowPanel({
  session,
  active,
  barcode,
  epc,
  iataLpc,
  photoOverrideReason,
  busy,
  setBarcode,
  setEpc,
  setIataLpc,
  setPhotoOverrideReason,
  canOverridePhoto,
  action,
}: {
  session: WorkflowSession;
  active: QueueItem;
  barcode: string;
  epc: string;
  iataLpc: string;
  photoOverrideReason: string;
  busy: boolean;
  setBarcode: (value: string) => void;
  setEpc: (value: string) => void;
  setIataLpc: (value: string) => void;
  setPhotoOverrideReason: (value: string) => void;
  canOverridePhoto: boolean;
  action: (body: Record<string, unknown>) => Promise<void>;
}) {
  const mutation = (name: string, extra: Record<string, unknown> = {}) => ({
    action: name,
    sessionId: session.id,
    expectedVersion: session.version,
    requestId: mutationId(name.toLowerCase()),
    ...extra,
  });
  const photoSatisfied =
    session.photoPolicy !== "REQUIRED" ||
    ["STAGED", "CAPTURED", "MISSING_OVERRIDE"].includes(session.photoStatus);
  const canCapturePhoto = session.photoPolicy !== "DISABLED" && session.photoStatus !== "CAPTURED";
  return (
    <div className="mt-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Server session</p>
          <p className="font-mono text-sm">{session.id}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {session.state}
        </span>
      </div>
      <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">BHS BagID</dt>
          <dd className="font-mono">{session.bhsUid}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Mode</dt>
          <dd>{session.provisioningMode}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Expected EPC</dt>
          <dd className="font-mono">{session.expectedEpc ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Verified EPC</dt>
          <dd className="font-mono">{session.verifiedEpc ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Photo</dt>
          <dd>
            {session.photoPolicy} · {session.photoStatus}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Failure</dt>
          <dd>{session.failureCode ?? "—"}</dd>
        </div>
      </dl>
      {session.state === "READY_FOR_INPUT" ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="RFID tag barcode"
            placeholder="Scan RFID tag barcode"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
          />
          <Input
            aria-label="Expected EPC"
            placeholder={
              session.provisioningMode === "PRE_ENCODED_TAG"
                ? "Read expected EPC (hex)"
                : "Reserved by server"
            }
            disabled={session.provisioningMode !== "PRE_ENCODED_TAG"}
            value={epc}
            onChange={(event) => setEpc(event.target.value)}
          />
          <Button
            disabled={busy || !barcode || (session.provisioningMode === "PRE_ENCODED_TAG" && !epc)}
            onClick={() =>
              void action(
                mutation("CAPTURE_TAG", {
                  barcode,
                  expectedEpc: session.provisioningMode === "PRE_ENCODED_TAG" ? epc : null,
                  inputKind: "SCANNER",
                }),
              )
            }
          >
            Capture tag identity
          </Button>
        </div>
      ) : null}
      {session.state === "TAG_CAPTURED" && session.provisioningMode === "PRINT_AND_ENCODE" ? (
        <Button
          className="mt-4"
          disabled={busy}
          onClick={() => void action(mutation("RESERVE_EPC"))}
        >
          Reserve EPC
        </Button>
      ) : null}
      {session.state === "ENCODE_PENDING" ? (
        <Button className="mt-4" disabled={busy} onClick={() => void action(mutation("ENCODE"))}>
          Encode tag
        </Button>
      ) : null}
      {["VERIFY_PENDING", "ENCODED"].includes(session.state) ? (
        <Button className="mt-4" disabled={busy} onClick={() => void action(mutation("VERIFY"))}>
          Verify RFID read-back
        </Button>
      ) : null}
      {["VERIFIED", "PHOTO_PENDING", "PHOTO_CAPTURED", "READY_TO_COMMIT"].includes(
        session.state,
      ) ? (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input
              aria-label="Optional IATA LPC"
              placeholder="Optional 10-digit IATA LPC"
              value={iataLpc}
              onChange={(event) => setIataLpc(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void action(mutation("UPDATE_LPC", { iataLpc }))}
            >
              Save LPC
            </Button>
          </div>
          {canCapturePhoto ? (
            <Button disabled={busy} onClick={() => void action(mutation("CAPTURE_PHOTO"))}>
              <Camera /> Capture bag photo
            </Button>
          ) : null}
          {session.photoPolicy === "REQUIRED" && !photoSatisfied && canOverridePhoto ? (
            <div className="flex gap-2">
              <Input
                aria-label="Photo override reason"
                placeholder="Supervisor continuity reason"
                value={photoOverrideReason}
                onChange={(event) => setPhotoOverrideReason(event.target.value)}
              />
              <Button
                variant="outline"
                disabled={busy || photoOverrideReason.trim().length < 3}
                onClick={() =>
                  void action(mutation("OVERRIDE_PHOTO", { reason: photoOverrideReason }))
                }
              >
                Approve missing-photo override
              </Button>
            </div>
          ) : null}
          {photoSatisfied ? (
            <Button
              disabled={busy}
              onClick={() => void action(mutation("COMMIT", { queueItemId: active.id }))}
            >
              <CheckCircle2 /> Commit assignment
            </Button>
          ) : null}
        </div>
      ) : null}
      {session.state === "FAILED" ? (
        <Button
          className="mt-4"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void action(
              mutation("RETRY_SESSION", { reason: "Operator retry after failed tag attempt" }),
            )
          }
        >
          Retry with a new tag
        </Button>
      ) : null}
      {!["COMMITTED", "CANCELLED", "EXPIRED"].includes(session.state) ? (
        <Button
          className="mt-4 ml-2"
          variant="destructive"
          disabled={busy}
          onClick={() =>
            void action(
              mutation("CANCEL_SESSION", {
                reason: "Operator cancelled incomplete tagging session",
              }),
            )
          }
        >
          Cancel session
        </Button>
      ) : null}
    </div>
  );
}
