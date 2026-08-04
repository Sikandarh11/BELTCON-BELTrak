import { zodResolver } from "@hookform/resolvers/zod";
import { Pause, Play, PowerOff, Radio, RefreshCw, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { PageHeader, Panel } from "@/components/AppLayout";
import { AppApiError, readApiResponse } from "@/services/api/appApiError";

const healthSchema = z.object({
  readerId: z.string(),
  adapterType: z.enum(["SIMULATED", "UNAVAILABLE_PHYSICAL", "THINGMAGIC_IZAR", "ZEBRA_FX9600"]),
  state: z.enum([
    "UNKNOWN",
    "STARTING",
    "ONLINE",
    "DEGRADED",
    "OFFLINE",
    "MISCONFIGURED",
    "DISABLED",
    "SIMULATED",
  ]),
  connected: z.boolean(),
  startedAt: z.string().nullable(),
  lastReadAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

const ingestionResultSchema = z.object({
  outcome: z.enum(["STORED", "DUPLICATE_REPLAY"]),
  eventId: z.string().uuid(),
  sourceEventId: z.string(),
  readerId: z.string(),
  siteId: z.string(),
  epc: z.string(),
  receivedAt: z.string(),
  simulated: z.literal(true),
});

const readerSchema = z.object({
  readerId: z.string(),
  readerCode: z.string(),
  readerName: z.string(),
  adapterType: z.literal("SIMULATED"),
  enabled: z.boolean(),
  configurationVersion: z.number().int(),
  health: healthSchema,
});

const readersResponseSchema = z.object({ readers: z.array(readerSchema) });

const actionResponseSchema = z.object({
  readerId: z.string(),
  health: healthSchema.optional(),
  result: ingestionResultSchema.optional(),
  results: z.array(ingestionResultSchema).optional(),
});

const formSchema = z.object({
  readerId: z.string().min(1),
  epc: z.string().min(1),
  antennaPort: z.coerce.number().int().min(1),
  rssiDbm: z.number().finite().optional(),
  burstCount: z.coerce.number().int().min(1).max(10_000),
});

type FormValues = z.infer<typeof formSchema>;
type ActionResponse = z.infer<typeof actionResponseSchema>;

async function fetchReaders() {
  return readApiResponse<z.infer<typeof readersResponseSchema>>(
    await fetch("/api/dev/simulator/rfid/reads", { credentials: "include" }),
    "Unable to load RFID simulator readers",
  );
}

async function postAction(input: Record<string, unknown>) {
  return readApiResponse<ActionResponse>(
    await fetch("/api/dev/simulator/rfid/reads", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    "RFID simulator action failed",
  );
}

export function SimulatorPanel() {
  const readersQuery = useQuery({
    queryKey: ["dev", "simulator", "rfid", "readers"],
    queryFn: fetchReaders,
  });
  const [result, setResult] = useState<ActionResponse | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { readerId: "", epc: "", antennaPort: 1, rssiDbm: -45, burstCount: 2 },
  });

  const readers = useMemo(() => readersQuery.data?.readers ?? [], [readersQuery.data]);
  const selectedReaderId = form.watch("readerId");
  const selectedReader = useMemo(
    () => readers.find((reader) => reader.readerId === selectedReaderId) ?? null,
    [readers, selectedReaderId],
  );

  useEffect(() => {
    if (!form.getValues("readerId") && readers[0]) {
      form.setValue("readerId", readers[0].readerId, { shouldDirty: false, shouldTouch: false });
    }
  }, [form, readers]);

  const actionMutation = useMutation({
    mutationFn: postAction,
    onSuccess: async (data) => {
      setResult(data);
      setFailureCode(null);
      await readersQuery.refetch();
    },
    onError: (error) => {
      setResult(null);
      setFailureCode(error instanceof AppApiError ? error.code ?? null : "RFID_QUERY_FAILED");
    },
  });

  async function runAction(action: string, extra: Record<string, unknown> = {}) {
    const values = form.getValues();
    if (!values.readerId) return;
    await actionMutation.mutateAsync({ action, readerId: values.readerId, ...extra });
  }

  const emitOne = form.handleSubmit(async (values) => {
    await runAction("emit", {
      epc: values.epc,
      antennaPort: values.antennaPort,
      rssiDbm: values.rssiDbm,
      burstCount: 1,
    });
  });

  const emitBurst = form.handleSubmit(async (values) => {
    await runAction("emit", {
      epc: values.epc,
      antennaPort: values.antennaPort,
      rssiDbm: values.rssiDbm,
      burstCount: values.burstCount,
    });
  });

  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON RFID Reader Simulator"
        subtitle="Software simulator. No physical RFID hardware connected."
        actions={
          <button
            type="button"
            onClick={() => {
              void readersQuery.refetch();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm"
          >
            <RefreshCw className="size-4" />
            Refresh data
          </button>
        }
      />
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Configured SIMULATED readers" className="col-span-12 lg:col-span-7">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Reader
              <select
                {...form.register("readerId")}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">Select reader</option>
                {readers.map((reader) => (
                  <option key={reader.readerId} value={reader.readerId}>
                    {reader.readerCode} - {reader.readerName} - {reader.health.state}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              EPC
              <input
                {...form.register("epc")}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 font-mono"
                placeholder="Malformed EPCs are allowed"
              />
            </label>
            <label className="text-sm font-medium">
              Antenna port
              <input
                {...form.register("antennaPort", { valueAsNumber: true })}
                type="number"
                min={1}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>
            <label className="text-sm font-medium">
              RSSI dBm <span className="font-normal text-muted-foreground">(optional)</span>
              <input
                {...form.register("rssiDbm", {
                  setValueAs: (value) => (value === "" ? undefined : Number(value)),
                })}
                type="number"
                step="0.1"
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>
            <label className="text-sm font-medium md:col-span-2">
              Duplicate burst count
              <input
                {...form.register("burstCount", { valueAsNumber: true })}
                type="number"
                min={1}
                max={10_000}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>
            <div className="md:col-span-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              <strong>Adapter health</strong>
              <p className="mt-1 text-muted-foreground">
                {selectedReader
                  ? `${selectedReader.readerCode} - ${selectedReader.health.state} - ${selectedReader.health.connected ? "connected" : "disconnected"}`
                  : "Choose a configured SIMULATED reader."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runAction("start")}
              disabled={actionMutation.isPending || !selectedReaderId}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Play className="size-4" />
              Start
            </button>
            <button
              type="button"
              onClick={() => void runAction("stop")}
              disabled={actionMutation.isPending || !selectedReaderId}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 font-semibold disabled:opacity-50"
            >
              <Pause className="size-4" />
              Stop
            </button>
            <button
              type="button"
              onClick={() => void emitOne()}
              disabled={actionMutation.isPending || !selectedReaderId}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 font-semibold disabled:opacity-50"
            >
              <Radio className="size-4" />
              Emit one read
            </button>
            <button
              type="button"
              onClick={() => void emitBurst()}
              disabled={actionMutation.isPending || !selectedReaderId}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 font-semibold disabled:opacity-50"
            >
              <Zap className="size-4" />
              Emit duplicate burst
            </button>
            <button
              type="button"
              onClick={() => void runAction("disconnect")}
              disabled={actionMutation.isPending || !selectedReaderId}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 font-semibold disabled:opacity-50"
            >
              <PowerOff className="size-4" />
              Disconnect
            </button>
            <button
              type="button"
              onClick={() => void runAction("reconnect")}
              disabled={actionMutation.isPending || !selectedReaderId}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 font-semibold disabled:opacity-50"
            >
              <RefreshCw className="size-4" />
              Reconnect
            </button>
          </div>
          {actionMutation.isError ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {actionMutation.error instanceof Error ? actionMutation.error.message : "RFID action failed"}
            </p>
          ) : null}
        </Panel>
        <Panel title="Processing result" className="col-span-12 lg:col-span-5">
          {result ? (
            <Result result={result} failureCode={failureCode} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Awaiting a server-confirmed adapter action.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Result({
  result,
  failureCode,
}: {
  result: ActionResponse;
  failureCode: string | null;
}) {
  const latest = result.result ?? result.results?.[result.results.length - 1] ?? null;

  return (
    <div className="grid gap-3 text-sm">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Software simulator
        </div>
        <div className="mt-1 text-sm">No physical RFID hardware connected</div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt>Reader</dt>
        <dd className="font-mono">{result.readerId}</dd>
        <dt>Outcome</dt>
        <dd className="font-mono">{latest?.outcome ?? "—"}</dd>
        <dt>Event ID</dt>
        <dd className="font-mono">{latest?.eventId ?? "—"}</dd>
        <dt>Source event</dt>
        <dd className="font-mono">{latest?.sourceEventId ?? "—"}</dd>
        <dt>EPC</dt>
        <dd className="font-mono">{latest?.epc ?? "—"}</dd>
        <dt>Persisted</dt>
        <dd className="font-mono">{latest?.receivedAt ?? "—"}</dd>
        <dt>Simulated</dt>
        <dd>{latest?.simulated ? "Yes" : "No"}</dd>
        <dt>Failure</dt>
        <dd className="font-mono">{failureCode ?? "—"}</dd>
        {result.health ? (
          <>
            <dt>Started</dt>
            <dd className="font-mono">{result.health.startedAt ?? "—"}</dd>
            <dt>Last read</dt>
            <dd className="font-mono">{result.health.lastReadAt ?? "—"}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
