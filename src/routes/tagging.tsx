import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, ScanLine, Tag, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useWorkspaceMode } from "@/auth/SessionContext";
import { PageHeader, Panel } from "@/components/AppLayout";
import { useAssignRfidTag, useTaggingQueue } from "@/services/bags/taggingClient";
import { RFID_TRACKABLE_BAGS_QUERY_KEY } from "@/services/bags/rfidTrackableClient";
import type { TaggingBag } from "@/types/tagging";

export const Route = createFileRoute("/tagging")({
  head: () => ({ meta: [{ title: "BELTCON Tagging Station" }] }),
  component: TaggingStation,
});

const schema = z.object({
  rfidTagBarcode: z.string().trim().min(1, "RFID tag barcode is required").max(128),
  epc: z.string().trim().min(1, "RFID EPC is required").max(128),
  iataLpc: z.union([
    z.literal(""),
    z.string().regex(/^\d{10}$/, "IATA Licence Plate Code must be 10 numeric digits"),
  ]),
});
type FormValues = z.infer<typeof schema>;
const display = (value: string | null | undefined) => value?.trim() || "Not provided";

function TaggingStation() {
  const { workspaceMode } = useWorkspaceMode();
  const queue = useTaggingQueue();
  const assign = useAssignRfidTag();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<TaggingBag[]>([]);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { rfidTagBarcode: "", epc: "", iataLpc: "" },
  });
  const barcodeField = form.register("rfidTagBarcode");
  const bags = queue.data ?? [];
  const selected = bags.find((bag) => bag.id === selectedId) ?? null;
  const tagAssignmentDisabled = !selected?.canAssignTag;
  const filtered = bags.filter((bag) =>
    `${bag.id} ${bag.bhsUid} ${bag.bhsLineId ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  useEffect(() => {
    if (selected?.id) {
      form.reset();
      requestAnimationFrame(() => barcodeRef.current?.focus());
    }
  }, [form, selected?.id]);
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);
  const onSubmit = form.handleSubmit(async (values) => {
    if (!selected || !selected.canAssignTag) return;
    try {
      const bag = await assign.mutateAsync({
        bagId: selected.id,
        input: {
          ...values,
          iataLpc: values.iataLpc || undefined,
          expectedVersion: selected.version,
        },
      });
      setRecent((items) => [bag, ...items.filter((item) => item.id !== bag.id)].slice(0, 10));
      await queryClient.invalidateQueries({
        queryKey: RFID_TRACKABLE_BAGS_QUERY_KEY,
        refetchType: "all",
      });
      form.reset();
      setSelectedId(null);
      toast.success(`RFID tag assigned to ${bag.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "RFID tag assignment failed");
      barcodeRef.current?.focus();
    }
  });
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Tagging Station"
        subtitle="Associate RFID labels with authoritative BHS BagID queue records."
        actions={
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            <strong>{bags.length}</strong> pending
          </div>
        }
      />
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Tagging Queue" className="col-span-12 lg:col-span-4">
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
                placeholder="Search BagID / BHS BagID"
              />
            </div>
            <button
              type="button"
              onClick={() => void queue.refetch()}
              className="rounded-md border border-border px-3"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
          {queue.isLoading ? (
            <div className="space-y-2">
              <div className="h-16 animate-pulse rounded bg-muted" />
              <div className="h-16 animate-pulse rounded bg-muted" />
            </div>
          ) : queue.isError ? (
            <div
              role="alert"
              className="rounded border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
            >
              <AlertCircle className="mr-1 inline size-4" />
              {queue.error instanceof Error
                ? queue.error.message
                : "Unable to load the Tagging Queue"}
              <button
                type="button"
                onClick={() => void queue.refetch()}
                className="mt-2 block underline"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No bags are currently waiting for RFID tag assignment.
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((bag) => (
                <li key={bag.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(bag.id)}
                    className={`w-full rounded-md border p-3 text-left ${selectedId === bag.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}
                  >
                    <div className="flex justify-between gap-2">
                      <strong className="font-mono text-sm">{bag.bhsUid}</strong>
                      <span className="text-xs">
                        {bag.screeningEvaluation ?? "Screening pending"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Bag {bag.id} · Line {display(bag.bhsLineId)} · {bag.status}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title={selected ? `Assign RFID Tag · ${selected.bhsUid}` : "Assign RFID Tag"}
          className="col-span-12 lg:col-span-5"
        >
          {!selected ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              <Tag className="mx-auto mb-2 size-8 opacity-40" />
              Select a bag from the authoritative Tagging Queue.
            </p>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded border border-border p-3 text-xs">
                <dt>BHS BagID</dt>
                <dd className="font-mono">{selected.bhsUid}</dd>
                <dt>Line</dt>
                <dd>{display(selected.bhsLineId)}</dd>
                <dt>Screening Result</dt>
                <dd>{display(selected.screeningEvaluation)}</dd>
                <dt>BHS routing</dt>
                <dd>
                  {selected.bhsConfirmationStatus === "CONFIRMED"
                    ? "BHS diversion confirmed"
                    : "Awaiting BHS diversion confirmation"}
                </dd>
                <dt>Tagging readiness</dt>
                <dd>{selected.taggingReadiness}</dd>
                <dt>Flight</dt>
                <dd>{display(selected.flightNo)}</dd>
                <dt>Passenger</dt>
                <dd>{display(selected.passengerName)}</dd>
                <dt>X-ray</dt>
                <dd>
                  {selected.xrayStatus} · {selected.xrayViewCount} views (non-blocking)
                </dd>
                <dt>Version</dt>
                <dd>{selected.version}</dd>
              </dl>
              {!selected.canAssignTag ? (
                <p className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                  RFID assignment will be enabled after BHS message 2001 confirms the diversion.
                </p>
              ) : null}
              <form onSubmit={onSubmit} className="space-y-3">
                <label className="block text-sm font-medium">
                  RFID Tag Barcode
                  <input
                    {...barcodeField}
                    ref={(element) => {
                      barcodeField.ref(element);
                      barcodeRef.current = element;
                    }}
                    autoComplete="off"
                    disabled={tagAssignmentDisabled}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono"
                  />
                  {form.formState.errors.rfidTagBarcode && (
                    <span className="text-xs text-danger">
                      {form.formState.errors.rfidTagBarcode.message}
                    </span>
                  )}
                </label>
                <label className="block text-sm font-medium">
                  RFID EPC
                  <input
                    {...form.register("epc")}
                    autoComplete="off"
                    disabled={tagAssignmentDisabled}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono"
                  />
                  {form.formState.errors.epc && (
                    <span className="text-xs text-danger">{form.formState.errors.epc.message}</span>
                  )}
                </label>
                <label className="block text-sm font-medium">
                  IATA Licence Plate Code{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                  <input
                    {...form.register("iataLpc")}
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={tagAssignmentDisabled}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono"
                  />
                </label>
                <div className="flex gap-2">
                  {workspaceMode === "Developer" ? (
                    <button
                      type="button"
                      disabled={tagAssignmentDisabled}
                      onClick={() =>
                        form.setValue("epc", `EPC-${selected.id.slice(-8).toUpperCase()}`, {
                          shouldValidate: true,
                        })
                      }
                      className="rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <WandSparkles className="mr-1 inline size-4" />
                      Generate EPC
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={assign.isPending || tagAssignmentDisabled}
                    className="flex-1 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    <Tag className="mr-1 inline size-4" />
                    {assign.isPending ? "Assigning…" : "Assign RFID Tag"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </Panel>
        <Panel title="Recently Assigned" className="col-span-12 lg:col-span-3">
          {recent.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No tags assigned in this session.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((bag) => (
                <li key={bag.id} className="rounded border border-border p-3 text-xs">
                  <div className="font-mono">{bag.bhsUid}</div>
                  <div className="mt-1 text-success">{bag.rfidTagBarcode}</div>
                  <div className="mt-1 font-mono text-muted-foreground">{bag.epc}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
