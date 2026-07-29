import { zodResolver } from "@hookform/resolvers/zod";
import { RefreshCw, Radio } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PageHeader, Panel } from "@/components/AppLayout";
import { useRfidTrackableBags } from "@/services/bags/rfidTrackableClient";
import { useReaderAntennaMap, useSubmitSimulatedRfidRead } from "@/services/rfid/rfidClient";

const schema = z.object({
  bagId: z.string().min(1),
  readerId: z.string().min(1),
  antennaPort: z.coerce.number().int().min(1).max(64),
  rssiDbm: z.coerce.number().min(-130).max(20).optional(),
});
type FormValues = z.infer<typeof schema>;
function newEventId() {
  return `RFID-SIM-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

/** SBTS Baseline V1 simulator. Location authority remains entirely server-side. */
export function SimulatorPanel() {
  const bagsQuery = useRfidTrackableBags();
  const mapQuery = useReaderAntennaMap();
  const mutation = useSubmitSimulatedRfidRead();
  const [result, setResult] = useState<Awaited<ReturnType<typeof mutation.mutateAsync>> | null>(
    null,
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { bagId: "", readerId: "", antennaPort: 1, rssiDbm: -45 },
  });
  const selectedReader = form.watch("readerId");
  const readerMappings = useMemo(
    () => (mapQuery.data ?? []).filter((item) => item.readerId === selectedReader),
    [mapQuery.data, selectedReader],
  );
  const selectedPort = form.watch("antennaPort");
  const selectedAntenna = readerMappings.find((item) => item.antennaPort === selectedPort) ?? null;
  const onSubmit = form.handleSubmit(async (values) => {
    const bag = (bagsQuery.data ?? []).find((item) => item.id === values.bagId);
    if (!bag?.epc) return;
    setResult(null);
    try {
      setResult(
        await mutation.mutateAsync({
          sourceEventId: newEventId(),
          readerId: values.readerId,
          antennaPort: values.antennaPort,
          epc: bag.epc,
          readAt: new Date().toISOString(),
          rssiDbm: values.rssiDbm,
          tid: undefined,
        }),
      );
    } catch {
      setResult(null);
    }
  });
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON RFID Simulator"
        subtitle="Submit an RFID reader + antenna read. Location is validated and derived by the server."
        actions={
          <button
            type="button"
            onClick={() => {
              void bagsQuery.refetch();
              void mapQuery.refetch();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm"
          >
            <RefreshCw className="size-4" />
            Refresh data
          </button>
        }
      />
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Authoritative RFID read" className="col-span-12 lg:col-span-7">
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Tagged unresolved bag
              <select
                {...form.register("bagId")}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">Select a bag</option>
                {(bagsQuery.data ?? []).map((bag) => (
                  <option key={bag.id} value={bag.id}>
                    {bag.id} · {bag.bhsUid ?? "BHS not supplied"} · {bag.epc}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Reader
              <select
                {...form.register("readerId", { onChange: () => form.setValue("antennaPort", 1) })}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">Select reader</option>
                {[
                  ...new Map((mapQuery.data ?? []).map((item) => [item.readerId, item])).values(),
                ].map((reader) => (
                  <option key={reader.readerId} value={reader.readerId}>
                    {reader.readerName} ({reader.readerId})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Antenna port
              <select
                {...form.register("antennaPort", { valueAsNumber: true })}
                disabled={!selectedReader}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 disabled:opacity-50"
              >
                <option value={1}>Select antenna</option>
                {readerMappings.map((antenna) => (
                  <option key={antenna.antennaId} value={antenna.antennaPort}>
                    Port {antenna.antennaPort} · {antenna.antennaName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              RSSI dBm <span className="font-normal text-muted-foreground">(optional)</span>
              <input
                type="number"
                step="0.1"
                {...form.register("rssiDbm", { valueAsNumber: true })}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>
            <div className="md:col-span-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              <strong>Configured location</strong>
              <p className="mt-1 text-muted-foreground">
                {selectedAntenna
                  ? `${selectedAntenna.zoneCode.replace(/_/g, " ")} — informational only; the server validates it again.`
                  : "Choose a configured reader and antenna."}
              </p>
            </div>
            <button
              type="submit"
              disabled={mutation.isPending || !selectedAntenna}
              className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Radio className="size-4" />
              {mutation.isPending ? "Submitting read…" : "Submit RFID Read"}
            </button>
          </form>
          {mutation.isError ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {mutation.error instanceof Error ? mutation.error.message : "RFID read failed"}
            </p>
          ) : null}
        </Panel>
        <Panel title="Processing result" className="col-span-12 lg:col-span-5">
          {result ? (
            <Result result={result} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Awaiting a server-confirmed RFID read.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
function Result({
  result,
}: {
  result: {
    requestId: string;
    result: {
      outcome: string;
      duplicate: boolean;
      eventId: string | null;
      bagId: string | null;
      bhsUid: string | null;
      epc: string | null;
      readerId: string | null;
      antennaPort: number | null;
      zone: string | null;
      previousStatus: string | null;
      currentStatus: string | null;
      alarmEligible: boolean;
      alarm: {
        id: string;
        status: string;
        severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        created: boolean;
      } | null;
    };
  };
}) {
  const read = result.result;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt>Outcome</dt>
      <dd className="font-semibold">{read.outcome}</dd>
      <dt>Event ID</dt>
      <dd className="font-mono">{read.eventId ?? "—"}</dd>
      <dt>Bag / BHS</dt>
      <dd>
        {read.bagId ?? "—"} · {read.bhsUid ?? "—"}
      </dd>
      <dt>EPC</dt>
      <dd className="font-mono">{read.epc ?? "—"}</dd>
      <dt>Reader / antenna</dt>
      <dd>
        {read.readerId ?? "—"} / {read.antennaPort ?? "—"}
      </dd>
      <dt>Server location</dt>
      <dd>{read.zone ?? "—"}</dd>
      <dt>Lifecycle</dt>
      <dd>
        {read.previousStatus ?? "—"} → {read.currentStatus ?? "—"}
      </dd>
      <dt>Alarm eligibility</dt>
      <dd>
        {read.alarm
          ? `${read.alarm.created ? "Created" : "Existing active alarm reused"}: ${read.alarm.id} (${read.alarm.status}, ${read.alarm.severity})`
          : read.alarmEligible
            ? "No active alarm was created for this bag state."
            : "No"}
      </dd>
      <dt>Request ID</dt>
      <dd className="font-mono">{result.requestId}</dd>
      {read.outcome === "UNASSIGNED_EPC" ? (
        <>
          <dt>Note</dt>
          <dd>RFID event recorded, but the EPC is not assigned to an active bag.</dd>
        </>
      ) : null}
    </dl>
  );
}
