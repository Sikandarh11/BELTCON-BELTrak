import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Pencil, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useSession } from "@/auth/SessionContext";
import { PageHeader, Panel, StatusPill } from "@/components/AppLayout";
import { AppApiError } from "@/services/api/appApiError";
import {
  useReader,
  useReaders,
  useUpdateAntenna,
  useUpdateReader,
} from "@/services/readers/readerClient";
import {
  READER_ZONES,
  type ReaderListFilters,
  type UpdateAntennaInput,
  type UpdateReaderInput,
  updateAntennaSchema,
  updateReaderSchema,
} from "@/services/readers/readerSchemas";

export const Route = createFileRoute("/readers")({
  head: () => ({ meta: [{ title: "BELTCON Reader Management · BELTCON SBTS" }] }),
  component: Readers,
});

function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Reader request failed";
}

function ReaderConfiguration({ readerId }: { readerId: string }) {
  const session = useSession();
  const detailQuery = useReader(readerId);
  const updateReader = useUpdateReader();
  const updateAntenna = useUpdateAntenna();
  const canManage = session.permissions.includes("reader.manage");
  const readerForm = useForm<UpdateReaderInput>({
    resolver: zodResolver(updateReaderSchema),
    defaultValues: { name: "", enabled: true, expectedVersion: 1, reason: "" },
  });

  useEffect(() => {
    const reader = detailQuery.data;
    if (reader) {
      readerForm.reset({
        name: reader.name,
        enabled: reader.enabled,
        model: reader.model ?? undefined,
        vendor: reader.vendor ?? undefined,
        firmwareVersion: reader.firmwareVersion ?? undefined,
        expectedVersion: reader.version,
        reason: "",
      });
    }
  }, [detailQuery.data, readerForm]);

  if (detailQuery.isLoading)
    return (
      <div className="h-80 animate-pulse rounded bg-muted" aria-label="Loading reader detail" />
    );
  if (detailQuery.isError) {
    return (
      <p role="alert" className="py-8 text-sm text-danger">
        {errorMessage(detailQuery.error)}
      </p>
    );
  }
  const reader = detailQuery.data;
  if (!reader) return null;

  const submitReader = readerForm.handleSubmit(async (input) => {
    try {
      await updateReader.mutateAsync({ readerId: reader.id, input });
      toast.success("Reader configuration saved.");
      readerForm.setValue("reason", "");
    } catch (error) {
      if (error instanceof AppApiError && error.status === 409) {
        await detailQuery.refetch();
        toast.error(
          "This reader was changed by another user. The latest configuration has been loaded.",
        );
      } else toast.error(errorMessage(error));
    }
  });

  return (
    <div className="space-y-4">
      <Panel title="Reader summary">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Reader ID</dt>
          <dd className="font-mono">{reader.readerCode}</dd>
          <dt className="text-muted-foreground">Health</dt>
          <dd>
            <StatusPill status={reader.calculatedHealth} />
          </dd>
          <dt className="text-muted-foreground">Last seen</dt>
          <dd>{date(reader.lastSeenAt)}</dd>
          <dt className="text-muted-foreground">Last read</dt>
          <dd>{date(reader.lastReadAt)}</dd>
          <dt className="text-muted-foreground">Model</dt>
          <dd>{reader.model ?? "Not configured"}</dd>
          <dt className="text-muted-foreground">Vendor</dt>
          <dd>{reader.vendor ?? "Not configured"}</dd>
          <dt className="text-muted-foreground">Firmware</dt>
          <dd>{reader.firmwareVersion ?? "Not configured"}</dd>
        </dl>
      </Panel>
      <Panel title="Activity (server-derived)">
        <div className="grid grid-cols-2 gap-3 text-center text-sm md:grid-cols-5">
          {Object.entries(reader.activity).map(([label, value]) => (
            <div key={label} className="rounded bg-muted/50 p-2">
              <div className="font-semibold">{value}</div>
              <div className="text-xs text-muted-foreground">
                {label.replace(/([A-Z])/g, " $1")}
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Reader configuration">
        {canManage ? (
          <form
            onSubmit={(event) => void submitReader(event)}
            className="grid gap-3 md:grid-cols-2"
          >
            <label className="text-xs">
              Name
              <input
                {...readerForm.register("name")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs">
              Model
              <input
                {...readerForm.register("model")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs">
              Vendor
              <input
                {...readerForm.register("vendor")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs">
              Firmware version
              <input
                {...readerForm.register("firmwareVersion")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...readerForm.register("enabled")} /> Enabled
            </label>
            <label className="text-xs">
              Change reason
              <input
                {...readerForm.register("reason")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={updateReader.isPending}
              className="inline-flex w-fit items-center gap-1 rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              <Save className="size-4" />
              {updateReader.isPending ? "Saving…" : "Save configuration"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            You can view this configuration but need reader.manage to update it.
          </p>
        )}
      </Panel>
      <Panel title="Antenna mapping">
        {reader.antennas.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No authoritative antenna mappings are configured.
          </p>
        ) : (
          <div className="space-y-3">
            {reader.antennas.map((antenna) => (
              <AntennaConfiguration
                key={antenna.id}
                readerId={reader.id}
                canManage={canManage}
                antenna={antenna}
                onSave={updateAntenna.mutateAsync}
                saving={updateAntenna.isPending}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function AntennaConfiguration({
  readerId,
  antenna,
  canManage,
  onSave,
  saving,
}: {
  readerId: string;
  antenna: NonNullable<ReturnType<typeof useReader>["data"]>["antennas"][number];
  canManage: boolean;
  onSave: ReturnType<typeof useUpdateAntenna>["mutateAsync"];
  saving: boolean;
}) {
  const form = useForm<UpdateAntennaInput>({
    resolver: zodResolver(updateAntennaSchema),
    defaultValues: {
      name: antenna.name,
      zoneCode: antenna.zoneCode,
      direction: antenna.direction as UpdateAntennaInput["direction"],
      enabled: antenna.enabled,
      transmitPowerDbm: antenna.transmitPowerDbm,
      expectedVersion: antenna.version,
      reason: "",
    },
  });
  useEffect(
    () =>
      form.reset({
        name: antenna.name,
        zoneCode: antenna.zoneCode,
        direction: antenna.direction as UpdateAntennaInput["direction"],
        enabled: antenna.enabled,
        transmitPowerDbm: antenna.transmitPowerDbm,
        expectedVersion: antenna.version,
        reason: "",
      }),
    [antenna, form],
  );
  const submit = form.handleSubmit(async (input) => {
    try {
      await onSave({ readerId, antennaId: antenna.id, input });
      toast.success("Antenna configuration saved.");
      form.setValue("reason", "");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="rounded border border-border p-3 text-sm"
    >
      <div className="mb-2 flex justify-between gap-2">
        <span>
          Port {antenna.port} ·{" "}
          {antenna.lastReadAt ? `Last read ${date(antenna.lastReadAt)}` : "No read recorded"}
        </span>
        <StatusPill status={antenna.enabled ? "ENABLED" : "DISABLED"} />
      </div>
      {canManage ? (
        <div className="grid gap-2 md:grid-cols-3">
          <input
            {...form.register("name")}
            aria-label={`Antenna ${antenna.port} name`}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          />
          <select
            {...form.register("zoneCode")}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          >
            {READER_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <select
            {...form.register("direction")}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          >
            <option value="">Direction not configured</option>
            <option value="INBOUND">Inbound</option>
            <option value="OUTBOUND">Outbound</option>
            <option value="BIDIRECTIONAL">Bidirectional</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
          <input
            type="number"
            min="0"
            max="40"
            step="0.1"
            {...form.register("transmitPowerDbm", {
              setValueAs: (value) => (value === "" ? null : Number(value)),
            })}
            placeholder="Power dBm"
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          />
          <input
            {...form.register("reason")}
            placeholder="Change reason"
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" {...form.register("enabled")} />
            Enabled
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-fit rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
          >
            Save antenna
          </button>
        </div>
      ) : (
        <div>
          {antenna.name} · {antenna.zoneCode} · {antenna.direction ?? "Direction not configured"} ·{" "}
          {antenna.transmitPowerDbm ?? "Power not configured"}
        </div>
      )}
    </form>
  );
}

function Readers() {
  const session = useSession();
  const [filters, setFilters] = useState<ReaderListFilters>({
    page: 1,
    pageSize: 25,
    sort: "readerCode",
    direction: "asc",
  });
  const [selectedReaderId, setSelectedReaderId] = useState<string | null>(null);
  const query = useReaders(filters);
  const canView = session.permissions.includes("reader.view");
  const totalPages = Math.max(1, query.data?.totalPages ?? 1);
  const limitations = useMemo(
    () => query.data?.dataLimitations ?? [],
    [query.data?.dataLimitations],
  );
  if (!canView)
    return (
      <div className="p-6">
        <PageHeader title="BELTCON Reader Management" subtitle="RFID reader inventory" />
        <p role="alert" className="rounded border border-danger/30 p-4 text-sm text-danger">
          Permission reader.view is required.
        </p>
      </div>
    );
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Reader Management"
        subtitle="Authoritative inventory, antenna mapping, and server-derived health."
        actions={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm"
          >
            <RefreshCw className="size-4" />
            Refresh
          </button>
        }
      />
      {limitations.map((limitation) => (
        <p
          key={limitation}
          className="mb-3 rounded border border-warning/30 bg-warning/5 p-2 text-xs text-warning"
        >
          {limitation}
        </p>
      ))}
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Reader inventory" className="col-span-12 lg:col-span-7 !p-0">
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <input
              value={filters.search ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  search: event.target.value || undefined,
                }))
              }
              placeholder="Search reader ID or name"
              className="h-9 flex-1 rounded border border-border bg-background px-2 text-sm"
            />
            <select
              value={filters.status ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  status: (event.target.value || undefined) as ReaderListFilters["status"],
                }))
              }
              className="h-9 rounded border border-border bg-background px-2 text-sm"
            >
              <option value="">All health states</option>
              {["ONLINE", "DEGRADED", "OFFLINE", "DISABLED", "UNKNOWN"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          {query.isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-14 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : query.isError ? (
            <div className="p-8 text-center text-sm">
              <p role="alert" className="text-danger">
                {errorMessage(query.error)}
              </p>
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="mt-2 rounded border border-border px-3 py-1.5"
              >
                Retry
              </button>
            </div>
          ) : query.data?.items.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              No authoritative readers match the selected filters.
            </p>
          ) : (
            <>
              <div className="max-h-[650px] overflow-auto">
                {query.data?.items.map((reader) => (
                  <button
                    type="button"
                    key={reader.id}
                    onClick={() => setSelectedReaderId(reader.id)}
                    className={`w-full border-b border-border p-3 text-left hover:bg-accent/40 ${selectedReaderId === reader.id ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex justify-between gap-2">
                      <span>
                        <span className="font-mono text-xs text-primary">{reader.readerCode}</span>
                        <span className="ml-2 text-sm font-medium">{reader.name}</span>
                      </span>
                      <StatusPill status={reader.calculatedHealth} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{reader.enabled ? "Enabled" : "Disabled"}</span>
                      <span>{reader.antennaCount} antennas</span>
                      <span>{reader.mappedZones.join(", ") || "No mapped zone"}</span>
                      <span>{reader.model ?? "Model not configured"}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between p-3 text-xs text-muted-foreground">
                <span>
                  Page {filters.page} of {totalPages} · {query.data?.total ?? 0} readers
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    disabled={filters.page <= 1}
                    onClick={() =>
                      setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                    }
                    className="rounded border border-border p-1 disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={filters.page >= totalPages}
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        page: Math.min(totalPages, current.page + 1),
                      }))
                    }
                    className="rounded border border-border p-1 disabled:opacity-40"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </span>
              </div>
            </>
          )}
        </Panel>
        <div className="col-span-12 lg:col-span-5">
          {selectedReaderId ? (
            <ReaderConfiguration readerId={selectedReaderId} />
          ) : (
            <Panel title="Reader detail">
              <div className="py-16 text-center text-sm text-muted-foreground">
                <Pencil className="mx-auto mb-2 size-5" />
                Select a reader to inspect its authoritative configuration and antenna mapping.
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
