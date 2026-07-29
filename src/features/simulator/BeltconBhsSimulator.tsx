import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PageHeader, Panel } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { auditKeys, bagKeys, bhsKeys, integrationKeys, taggingKeys } from "@/lib/queryKeys";
import { readApiResponse } from "@/services/api/appApiError";

type RawFormValues = z.infer<typeof BhsBagMessageV1Schema>;

interface PendingConfirmation {
  bagId: string;
  bhsUid: string;
  screeningEvaluationRaw: "R" | "T" | "N" | "?";
  screeningEvaluation: "REJECT" | "TIMEOUT" | "NO_DECISION" | "MISTRACK";
  screeningStation: string | null;
  screenedAt: string | null;
  threatSummary: string | null;
  xrayAvailable: boolean;
  confirmationStatus: "AWAITING_BHS_CONFIRMATION";
}

interface SimulatorResult {
  outcome: "ACCEPTED" | "DUPLICATE" | "REJECTED" | "FAILED";
  bhsUid: string;
  lineId: string;
  evaluation: string | null;
  bagId: string | null;
  duplicate: boolean;
  acknowledgement: { messageType: 2002; bhsUid: string; outcome: string; timing: string };
}

interface BhsSimulatorResponse {
  result: SimulatorResult;
  acknowledgement: SimulatorResult["acknowledgement"];
}

function formatEvaluation(raw: PendingConfirmation["screeningEvaluationRaw"]) {
  return `${raw} — ${raw === "R" ? "Reject" : raw === "T" ? "Timeout" : raw === "N" ? "No decision" : "Mistrack"}`;
}

async function fetchPendingConfirmations(): Promise<PendingConfirmation[]> {
  const response = await fetch("/api/dev/simulator/bhs/pending-confirmations", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const body = await readApiResponse<{ items: PendingConfirmation[] }>(
    response,
    "Unable to load pending BHS diversion confirmations",
  );
  return body.items;
}

async function confirmDiversion(
  bagId: string,
  input: { lineId: string; trigger: 1 },
): Promise<BhsSimulatorResponse> {
  const response = await fetch(
    `/api/dev/simulator/bhs/pending-confirmations/${encodeURIComponent(bagId)}/confirm`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return readApiResponse<BhsSimulatorResponse>(response, "BHS diversion confirmation failed");
}

async function sendRawMessage(message: RawFormValues): Promise<BhsSimulatorResponse> {
  const response = await fetch("/api/dev/simulator/bhs/messages", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  return readApiResponse<BhsSimulatorResponse>(response, "BHS simulator request failed");
}

function useBhsCacheInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: bhsKeys.pendingConfirmations() }),
      queryClient.invalidateQueries({ queryKey: taggingKeys.all }),
      queryClient.invalidateQueries({ queryKey: bagKeys.all }),
      queryClient.invalidateQueries({ queryKey: integrationKeys.bhsEvents() }),
      queryClient.invalidateQueries({ queryKey: auditKeys.all }),
    ]);
  };
}

/** Advanced-only raw semantic message test. Normal workflow uses pending confirmations. */
function useSimulateBhsMessage() {
  const invalidate = useBhsCacheInvalidation();
  return useMutation({ mutationFn: sendRawMessage, onSuccess: invalidate });
}

export function BeltconBhsSimulator() {
  const pending = useQuery({
    queryKey: bhsKeys.pendingConfirmations(),
    queryFn: fetchPendingConfirmations,
  });
  const invalidate = useBhsCacheInvalidation();
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [lineId, setLineId] = useState("01");
  const [result, setResult] = useState<SimulatorResult | null>(null);
  const selected = pending.data?.find((item) => item.bagId === selectedBagId) ?? null;
  const confirmation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Select a pending BHS diversion confirmation");
      return confirmDiversion(selected.bagId, { lineId, trigger: 1 });
    },
    onSuccess: async (response) => {
      setResult(response.result);
      setSelectedBagId(null);
      await invalidate();
    },
  });

  useEffect(() => {
    if (!selectedBagId && pending.data?.[0]) setSelectedBagId(pending.data[0].bagId);
  }, [pending.data, selectedBagId]);

  return (
    <div className="p-6 pt-2">
      <PageHeader
        title="BELTCON BHS Simulator"
        subtitle="Confirm BHS routing/diversion after HBSS suspect detection. This is not a physical-arrival claim."
      />
      <Tabs defaultValue="pending">
        <TabsList aria-label="BELTCON BHS Simulator mode">
          <TabsTrigger value="pending">Pending diversion confirmations</TabsTrigger>
          <TabsTrigger value="raw">Raw BHS Message Test</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
            <Panel title="Pending BHS Diversion Confirmations">
              <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  HBSS-only suspect cases require BHS message 2001 before RFID tag assignment.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void pending.refetch()}
                >
                  <RefreshCw /> Refresh
                </Button>
              </div>
              {pending.isLoading ? (
                <div className="space-y-2">
                  <div className="h-16 animate-pulse rounded bg-muted" />
                  <div className="h-16 animate-pulse rounded bg-muted" />
                </div>
              ) : pending.isError ? (
                <div
                  role="alert"
                  className="rounded border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
                >
                  Unable to load pending BHS diversion confirmations.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void pending.refetch()}
                  >
                    Retry
                  </button>
                </div>
              ) : (pending.data?.length ?? 0) === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No HBSS suspect cases are awaiting BHS diversion confirmation.
                </p>
              ) : (
                <ul className="space-y-2">
                  {pending.data?.map((item) => (
                    <li key={item.bagId}>
                      <button
                        type="button"
                        onClick={() => setSelectedBagId(item.bagId)}
                        className={`w-full rounded-md border p-3 text-left ${selectedBagId === item.bagId ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}
                      >
                        <div className="flex justify-between gap-2">
                          <strong className="font-mono text-sm">{item.bhsUid}</strong>
                          <span className="text-xs">
                            {formatEvaluation(item.screeningEvaluationRaw)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.screeningStation ?? "Screening station not provided"} ·{" "}
                          {item.xrayAvailable ? "X-ray available" : "X-ray unavailable"}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Confirm Diversion and Send Message 2001">
              {!selected ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Select a pending suspect case.
                </p>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void confirmation.mutateAsync().catch(() => undefined);
                  }}
                >
                  <label className="block">
                    <Label>BHS BagID</Label>
                    <Input className="mt-1 font-mono" value={selected.bhsUid} readOnly />
                  </label>
                  <label className="block">
                    <Label>Screening evaluation</Label>
                    <Input
                      className="mt-1"
                      value={formatEvaluation(selected.screeningEvaluationRaw)}
                      readOnly
                    />
                  </label>
                  <label className="block">
                    <Label>BHS Line ID</Label>
                    <Input
                      className="mt-1 font-mono"
                      maxLength={2}
                      value={lineId}
                      onChange={(event) => setLineId(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block">
                    <Label>Trigger</Label>
                    <Input className="mt-1 font-mono" value="1" readOnly />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    The server derives the BHS BagID and evaluation, assigns the simulator source,
                    and invokes the same authoritative BHS service as the real integration endpoint.
                  </p>
                  {confirmation.error ? (
                    <p role="alert" className="text-sm text-danger">
                      {confirmation.error instanceof Error
                        ? confirmation.error.message
                        : "BHS diversion confirmation failed"}
                    </p>
                  ) : null}
                  <Button type="submit" disabled={confirmation.isPending}>
                    <Send />
                    {confirmation.isPending
                      ? "Confirming…"
                      : "Confirm Diversion and Send Message 2001"}
                  </Button>
                </form>
              )}
            </Panel>
          </div>
        </TabsContent>
        <TabsContent value="raw" className="mt-4">
          <RawBhsMessageTest onResult={setResult} />
        </TabsContent>
      </Tabs>
      {result ? <ResultPanel result={result} /> : null}
    </div>
  );
}

function RawBhsMessageTest({ onResult }: { onResult: (result: SimulatorResult) => void }) {
  const mutation = useSimulateBhsMessage();
  const form = useForm<RawFormValues>({
    resolver: zodResolver(BhsBagMessageV1Schema),
    defaultValues: {
      messageType: 2001,
      trigger: 1,
      lineId: "01",
      bhsUid: "0000000001",
      evaluation: "R",
    },
  });
  return (
    <Panel title="Raw BHS Message Test">
      <p className="mb-4 text-xs text-warning">
        Advanced developer test only. It can simulate BHS-first arrival and is not the normal
        demonstration flow.
      </p>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={form.handleSubmit(async (values) => {
          const response = await mutation.mutateAsync(values);
          onResult(response.result);
        })}
      >
        <input type="hidden" {...form.register("messageType", { valueAsNumber: true })} />
        <input type="hidden" {...form.register("trigger", { valueAsNumber: true })} />
        <label>
          <Label>BHS BagID</Label>
          <Input className="mt-1 font-mono" {...form.register("bhsUid")} />
        </label>
        <label>
          <Label>BHS Line ID</Label>
          <Input className="mt-1 font-mono" maxLength={2} {...form.register("lineId")} />
        </label>
        <label>
          <Label>Evaluation</Label>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            {...form.register("evaluation")}
          >
            <option value="A">A — Accept</option>
            <option value="R">R — Reject</option>
            <option value="T">T — Timeout</option>
            <option value="N">N — No decision</option>
            <option value="?">? — Mistrack</option>
          </select>
        </label>
        <label>
          <Label>Trigger</Label>
          <Input className="mt-1 font-mono" value="1" readOnly />
        </label>
        {mutation.error ? (
          <p role="alert" className="text-sm text-danger md:col-span-2">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "BHS simulator request failed"}
          </p>
        ) : null}
        <Button type="submit" disabled={mutation.isPending} className="md:col-span-2">
          <Send />
          {mutation.isPending ? "Sending…" : "Send raw BHS message"}
        </Button>
      </form>
    </Panel>
  );
}

function ResultPanel({ result }: { result: SimulatorResult }) {
  return (
    <div className="mt-4 rounded-md border border-success/30 bg-success/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className="size-4" />
        {result.duplicate
          ? "Duplicate message"
          : result.outcome === "ACCEPTED"
            ? "BHS diversion confirmed"
            : "Message not accepted"}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt>BHS BagID</dt>
        <dd className="font-mono">{result.bhsUid}</dd>
        <dt>Line</dt>
        <dd>{result.lineId}</dd>
        <dt>Evaluation</dt>
        <dd>{result.evaluation}</dd>
        <dt>Bag</dt>
        <dd>{result.bagId ?? "No taggable bag created"}</dd>
        <dt>Acknowledgement</dt>
        <dd>
          {result.acknowledgement.outcome} · {result.acknowledgement.timing}
        </dd>
      </dl>
      <Button asChild className="mt-3" type="button" variant="outline">
        <Link to="/tagging">Open Tagging Station</Link>
      </Button>
    </div>
  );
}
