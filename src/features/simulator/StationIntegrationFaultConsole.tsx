import { AlertTriangle, Download, RotateCcw, Send, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Panel } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Snapshot = {
  simulation: true;
  generatedAt: string;
  bhs: {
    health: { state: string; pendingSynchronizations: number; pendingAcknowledgements: number };
    queue: {
      position1: { bhsUid: string; state: string } | null;
      position2: { bhsUid: string; state: string } | null;
      alarms: unknown[];
    };
  };
  hbss: {
    health: {
      state: string;
      requests: Array<{ requestId: string; state: string; bhsUid: string }>;
    };
    transmittedBytesHex: string[];
  };
  injectedFaults: Array<{ code: string; detail: string; createdAt: string }>;
};

async function decode(response: Response) {
  const body = (await response.json()) as Snapshot & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Software FAT action failed");
  return body;
}

export function StationIntegrationFaultConsole() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lineId, setLineId] = useState("01");
  const [bhsUid, setBhsUid] = useState("0012345678");
  const [evaluation, setEvaluation] = useState("R");
  const [barcode, setBarcode] = useState("RFID-SIM-0001");

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/dev/simulator/station-harness", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setSnapshot(await decode(response));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Software FAT action failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void fetch("/api/dev/simulator/station-harness", { credentials: "include" })
      .then(decode)
      .then(setSnapshot)
      .catch((requestError: unknown) =>
        setError(requestError instanceof Error ? requestError.message : "Console unavailable"),
      );
  }, []);

  function sendBhs(repeat = 1) {
    void action({
      action: "BHS_SEND",
      repeat,
      message: { messageType: 2001, trigger: 1, lineId, bhsUid, evaluation },
    });
  }

  function exportSnapshot() {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sbts-software-fat-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 p-6 pt-2">
      <div className="flex items-center justify-between rounded-md border border-info/30 bg-info/10 p-3 text-sm text-info">
        <span className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="size-4" /> SIMULATION · SOFTWARE FAT ONLY
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!snapshot}
            onClick={exportSnapshot}
          >
            <Download /> Export sanitized JSON
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void action({ action: "RESET" })}
          >
            <RotateCcw /> Reset
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="size-4" /> {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="BHS station transport">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={lineId}
              maxLength={2}
              onChange={(event) => setLineId(event.target.value)}
              aria-label="LineID"
            />
            <select
              value={evaluation}
              onChange={(event) => setEvaluation(event.target.value)}
              className="rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Evaluation"
            >
              <option value="A">A · Accept</option>
              <option value="R">R · Reject</option>
              <option value="T">T · Timeout</option>
              <option value="N">N · No decision</option>
              <option value="?">? · Mistrack</option>
            </select>
            <Input
              value={bhsUid}
              maxLength={10}
              onChange={(event) => setBhsUid(event.target.value)}
              className="col-span-2 font-mono"
              aria-label="BHS BagID"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => sendBhs()}>
              <Send /> Send 2001
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => sendBhs(2)}>
              Duplicate
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => sendBhs(3)}>
              Burst ×3
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_DISCONNECT" })}
            >
              Disconnect
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_RECONNECT" })}
            >
              Reconnect
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_FAIL_ACK", enabled: true })}
            >
              Fail Ack
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_ACK_DELAY", delayMs: 1000 })}
            >
              Delay Ack
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_JAM_ACTIVE", reason: "Software FAT jam" })}
            >
              Jam active
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_RESTART" })}
            >
              Restart agent
            </Button>
          </div>
        </Panel>

        <Panel title="HBSS virtual serial">
          <div className="space-y-2">
            <Input
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              aria-label="RFID barcode"
            />
            <Input
              value={bhsUid}
              maxLength={10}
              onChange={(event) => setBhsUid(event.target.value)}
              className="font-mono"
              aria-label="HBSS BagID"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action({
                  action: "HBSS_SCAN",
                  requestId: crypto.randomUUID(),
                  barcode,
                  bhsUid,
                })
              }
            >
              <Send /> Scan RFID
            </Button>
            {[
              ["PORT_UNAVAILABLE", "Port unavailable"],
              ["PARTIAL_WRITE", "Partial write"],
              ["TIMEOUT", "Timeout"],
              ["CORRUPTED_BYTES", "Corrupt bytes"],
              ["NONE", "Clear fault"],
            ].map(([fault, label]) => (
              <Button
                key={fault}
                size="sm"
                variant="outline"
                onClick={() => void action({ action: "HBSS_FAULT", fault })}
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "HBSS_RESTART" })}
            >
              Restart agent
            </Button>
          </div>
        </Panel>

        <Panel title="Central/server faults">
          <div className="flex flex-wrap gap-2">
            {[
              ["UNAVAILABLE", "Central unavailable"],
              ["SLOW_RESPONSE", "Slow response"],
              ["RESPONSE_LOST_AFTER_COMMIT", "Response lost"],
              ["AUTHENTICATION", "Authentication failure"],
              ["NONE", "Central recovered"],
            ].map(([fault, label]) => (
              <Button
                key={fault}
                size="sm"
                variant="outline"
                onClick={() => void action({ action: "BHS_CENTRAL_FAULT", fault })}
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_DATABASE_FAULT", enabled: true })}
            >
              Database unavailable
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void action({ action: "BHS_DATABASE_FAULT", enabled: false })}
            >
              Database recovered
            </Button>
          </div>
        </Panel>
      </div>

      <Panel title="Harness state">
        <div className="grid gap-3 text-xs md:grid-cols-3">
          <p>
            BHS agent: <strong>{snapshot?.bhs.health.state ?? "UNAVAILABLE"}</strong>
          </p>
          <p>
            Queue:{" "}
            <strong>
              {snapshot?.bhs.queue.position1 ? "ACTIVE" : "EMPTY"} /{" "}
              {snapshot?.bhs.queue.position2 ? "WAITING" : "EMPTY"}
            </strong>
          </p>
          <p>
            HBSS writes: <strong>{snapshot?.hbss.transmittedBytesHex.length ?? 0}</strong>
          </p>
        </div>
        <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted/30 p-3 text-[10px]">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </Panel>
    </div>
  );
}
