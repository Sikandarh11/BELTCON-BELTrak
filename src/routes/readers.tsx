import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Pencil, Power, PowerOff, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useSession } from "@/auth/SessionContext";
import { AppApiError } from "@/services/api/appApiError";
import { PageHeader, Panel, StatusPill } from "@/components/AppLayout";
import {
  useCreateReader,
  useReaders,
  useSetReaderEnabled,
  useUpdateReader,
} from "@/services/readers/readerClient";
import {
  READER_ZONES,
  readerAdapterTypeSchema,
  readerConfigurationInputSchema,
  type ReaderListFilters,
  type ReaderSummary,
  type UpdateReaderInput,
} from "@/services/readers/readerSchemas";

export const Route = createFileRoute("/readers")({
  head: () => ({ meta: [{ title: "BELTCON Reader Registry · BELTCON SBTS" }] }),
  component: Readers,
});

type ReaderFormInput = UpdateReaderInput;

const EMPTY_READER_FORM: ReaderFormInput = {
  readerCode: "",
  name: "",
  zone: "TAGGING",
  vendor: undefined,
  model: undefined,
  adapterType: "UNAVAILABLE_PHYSICAL",
  host: undefined,
  enabled: true,
  expectedVersion: 1,
};

const HEALTH_FILTERS = [
  "UNKNOWN",
  "STARTING",
  "ONLINE",
  "DEGRADED",
  "OFFLINE",
  "MISCONFIGURED",
  "DISABLED",
  "SIMULATED",
] as const;

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Reader request failed";
}

function normalizeReaderForm(reader?: ReaderSummary | null): ReaderFormInput {
  if (!reader) return EMPTY_READER_FORM;
  return {
    readerCode: reader.readerCode,
    name: reader.name,
    zone: reader.zone,
    vendor: reader.vendor ?? undefined,
    model: reader.model ?? undefined,
    adapterType: reader.adapterType,
    host: reader.host ?? undefined,
    enabled: reader.enabled,
    expectedVersion: reader.configurationVersion,
  };
}

function ReaderEditor({
  reader,
  onClose,
  onSelect,
  canManage,
}: {
  reader: ReaderSummary | null;
  onClose: () => void;
  onSelect?: (reader: ReaderSummary) => void;
  canManage: boolean;
}) {
  const createReader = useCreateReader();
  const updateReader = useUpdateReader();
  const setReaderEnabled = useSetReaderEnabled();
  const form = useForm<ReaderFormInput>({
    resolver: zodResolver(readerConfigurationInputSchema),
    defaultValues: normalizeReaderForm(reader),
  });

  useEffect(() => {
    form.reset(normalizeReaderForm(reader));
  }, [form, reader]);

  const submit = form.handleSubmit(async (values) => {
    try {
      if (reader) {
        const updated = await updateReader.mutateAsync({
          readerId: reader.id,
          input: { ...values, expectedVersion: reader.configurationVersion },
        });
        toast.success("Reader configuration saved.");
        onSelect?.(updated);
      } else {
        const created = await createReader.mutateAsync({ input: values });
        toast.success("Reader configuration created.");
        onSelect?.(created);
      }
    } catch (error) {
      if (error instanceof AppApiError && error.status === 409) {
        toast.error("This reader was changed by another user. Refresh and try again.");
      } else {
        toast.error(errorMessage(error));
      }
    }
  });

  if (!reader && !canManage) {
    return (
      <Panel title="Reader detail">
        <div className="py-16 text-center text-sm text-muted-foreground">
          Select a reader to inspect its authoritative configuration.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title={reader ? "Edit reader" : "Create reader"}
      action={
        canManage ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
          >
            <X className="size-3.5" />
            Close
          </button>
        ) : null
      }
    >
      {reader ? (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded border border-border bg-muted/30 p-3 text-xs">
          <div>
            <div className="text-muted-foreground">Site</div>
            <div className="font-medium">{reader.siteId}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Reader ID</div>
            <div className="font-mono font-medium">{reader.id}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Health</div>
            <StatusPill status={reader.healthStatus} />
          </div>
          <div>
            <div className="text-muted-foreground">Configuration version</div>
            <div className="font-medium">{reader.configurationVersion}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Last heartbeat</div>
            <div className="font-medium">{formatDate(reader.lastHeartbeatAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Last RFID event</div>
            <div className="font-medium">{formatDate(reader.lastEventAt)}</div>
          </div>
        </div>
      ) : null}

      {canManage ? (
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs">
              Reader code
              <input
                {...form.register("readerCode")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs">
              Name
              <input
                {...form.register("name")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs">
              Zone
              <select
                {...form.register("zone")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              >
                {READER_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Adapter type
              <select
                {...form.register("adapterType")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              >
                {readerAdapterTypeSchema.options.map((adapterType) => (
                  <option key={adapterType} value={adapterType}>
                    {adapterType}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Vendor
              <input
                {...form.register("vendor")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs">
              Model
              <input
                {...form.register("model")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs md:col-span-2">
              IP / host
              <input
                {...form.register("host")}
                className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register("enabled")} />
              Enabled
            </label>
          </div>

          {reader ? (
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Created: {formatDate(reader.createdAt)}</div>
              <div>Updated: {formatDate(reader.updatedAt)}</div>
              <div>Created by: {reader.createdBy ?? "Not available"}</div>
              <div>Updated by: {reader.updatedBy ?? "Not available"}</div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={createReader.isPending || updateReader.isPending}
              className="inline-flex items-center gap-2 rounded border border-primary bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              <Save className="size-4" />
              {reader
                ? updateReader.isPending
                  ? "Saving…"
                  : "Save reader"
                : createReader.isPending
                  ? "Creating…"
                  : "Create reader"}
            </button>
            {reader ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const toggled = await setReaderEnabled.mutateAsync({
                      readerId: reader.id,
                      input: {
                        enabled: !reader.enabled,
                        expectedVersion: reader.configurationVersion,
                      },
                    });
                    toast.success(toggled.enabled ? "Reader enabled" : "Reader disabled");
                    onSelect?.(toggled);
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
                disabled={setReaderEnabled.isPending}
                className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm disabled:opacity-50"
              >
                {reader.enabled ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                {reader.enabled ? "Disable" : "Enable"}
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>This site currently has no configured readers in the registry view.</p>
          <p>Reader health stays registry-owned until heartbeat processing is introduced.</p>
        </div>
      )}
    </Panel>
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
  const [selectedReader, setSelectedReader] = useState<ReaderSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useReaders(filters);
  const canView = session.permissions.includes("reader.view");
  const canManage = session.permissions.includes("reader.manage");
  const totalPages = Math.max(1, query.data?.totalPages ?? 1);
  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  if (!canView) {
    return null;
  }

  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Reader Registry"
        subtitle="Authoritative site registry for configured RFID readers."
        actions={
          <div className="flex items-center gap-2">
            {canManage ? (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setSelectedReader(null);
                }}
                className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm"
              >
                <Plus className="size-4" />
                Add reader
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm"
            >
              <RefreshCw className="size-4" />
              Refresh
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Readers" className="col-span-12 xl:col-span-7 !p-0">
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
              placeholder="Search reader code or name"
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
              {HEALTH_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          {query.isLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading configured readers…</div>
          ) : query.isError ? (
            <div className="p-8 text-center text-sm">
              <p role="alert" className="text-danger">
                Authoritative reader data is unavailable.
              </p>
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="mt-2 rounded border border-border px-3 py-1.5"
              >
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              No RFID readers are configured for this site.
            </p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-panel text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2">Reader</th>
                    <th className="px-3 py-2">Zone</th>
                    <th className="px-3 py-2">Vendor / Model</th>
                    <th className="px-3 py-2">Adapter</th>
                    <th className="px-3 py-2">IP / Host</th>
                    <th className="px-3 py-2">Health</th>
                    <th className="px-3 py-2">Enabled</th>
                    <th className="px-3 py-2">Heartbeat</th>
                    <th className="px-3 py-2">RFID event</th>
                    <th className="px-3 py-2">Version</th>
                    {canManage ? <th className="px-3 py-2">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((reader) => (
                    <tr
                      key={reader.id}
                      className={`border-b border-border/70 ${selectedReader?.id === reader.id ? "bg-primary/5" : "hover:bg-accent/30"}`}
                    >
                      <td className="px-3 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => {
                            setCreating(false);
                            setSelectedReader(reader);
                          }}
                          className="text-left"
                        >
                          <div className="font-medium">{reader.name}</div>
                          <div className="font-mono text-xs text-primary">{reader.readerCode}</div>
                        </button>
                      </td>
                      <td className="px-3 py-3 align-top text-xs">{reader.zone}</td>
                      <td className="px-3 py-3 align-top text-xs">
                        <div>{reader.vendor ?? "Not configured"}</div>
                        <div className="text-muted-foreground">{reader.model ?? "Not configured"}</div>
                      </td>
                      <td className="px-3 py-3 align-top text-xs">
                        <div>{reader.adapterType}</div>
                        {reader.adapterType === "SIMULATED" ? (
                          <span className="mt-1 inline-flex rounded border border-warning/30 bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                            SIMULATED
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-xs">{reader.host ?? "Not configured"}</td>
                      <td className="px-3 py-3 align-top">
                        <StatusPill status={reader.healthStatus} />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <StatusPill status={reader.enabled ? "Active" : "Inactive"} />
                      </td>
                      <td className="px-3 py-3 align-top text-xs">{formatDate(reader.lastHeartbeatAt)}</td>
                      <td className="px-3 py-3 align-top text-xs">{formatDate(reader.lastEventAt)}</td>
                      <td className="px-3 py-3 align-top text-xs font-medium">{reader.configurationVersion}</td>
                      {canManage ? (
                        <td className="px-3 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setCreating(false);
                                setSelectedReader(reader);
                              }}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
                            >
                              <Pencil className="size-3.5" />
                              Edit
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
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
                <span className="sr-only">Previous page</span>
                <span aria-hidden="true">◀</span>
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
                <span className="sr-only">Next page</span>
                <span aria-hidden="true">▶</span>
              </button>
            </span>
          </div>
        </Panel>

        <div className="col-span-12 xl:col-span-5">
          <ReaderEditor
            reader={creating ? null : selectedReader}
            canManage={canManage}
            onClose={() => {
              setCreating(false);
              setSelectedReader(null);
            }}
            onSelect={(reader) => {
              setCreating(false);
              setSelectedReader(reader);
            }}
          />
        </div>
      </div>
    </div>
  );
}
