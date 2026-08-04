import { AlertTriangle, Cable, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Panel } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";

type StationView = {
  health: {
    state: string;
    serial: { state: string; binding: string; detail?: string };
    requests: Array<{
      requestId: string;
      bhsUid: string;
      state: string;
      errorCode: string | null;
    }>;
  };
  simulation: boolean;
  transmittedFramesHex: string[];
};

async function decode(response: Response) {
  const body = (await response.json()) as StationView & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Recheck-station agent is unavailable");
  return body;
}

export function RecheckStationAgentPanel({ barcode }: { barcode: string | null }) {
  const [view, setView] = useState<StationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setView(null);
    setError(null);
  }, [barcode]);

  async function request(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/stations/recheck", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setView(await decode(response));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Station request failed");
    } finally {
      setBusy(false);
    }
  }

  const latest = view?.health.requests.at(-1) ?? null;
  return (
    <Panel title="HBSS Station Serial Request">
      <p className="text-sm text-muted-foreground">
        Sends the exact BHS BagID through the configured station adapter. A completed write means
        REQUEST_SENT only; image availability is reported separately below.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={busy || !barcode}
          onClick={() =>
            void request({ action: "REQUEST_RECALL", requestId: crypto.randomUUID(), barcode })
          }
        >
          <Cable /> Send station BID request
        </Button>
        {latest && ["FAILED", "TIMED_OUT", "UNAVAILABLE"].includes(latest.state) ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void request({ action: "RETRY", requestId: latest.requestId })}
          >
            <RotateCw /> Retry
          </Button>
        ) : null}
        {view?.simulation ? (
          <span className="rounded-full bg-info/10 px-2 py-1 text-xs font-semibold text-info">
            SIMULATION
          </span>
        ) : null}
      </div>
      {latest ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt>Serial request</dt>
          <dd>{latest.state}</dd>
          <dt>BHS BagID</dt>
          <dd className="font-mono">{latest.bhsUid}</dd>
          <dt>Serial binding</dt>
          <dd>{view?.health.serial.binding}</dd>
          <dt>Raw bytes</dt>
          <dd className="break-all font-mono">{view?.transmittedFramesHex.at(-1) ?? "None"}</dd>
        </dl>
      ) : null}
      {error ? (
        <div className="mt-3 flex gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="size-4" /> {error}
        </div>
      ) : null}
    </Panel>
  );
}
