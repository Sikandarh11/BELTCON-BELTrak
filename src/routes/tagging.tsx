import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Clock3, RefreshCw, ScanLine, Tag, WandSparkles } from "lucide-react";
import { toast } from "sonner";

import { useWorkspaceMode } from "@/auth/SessionContext";
import { Panel, PageHeader } from "@/components/AppLayout";
import {
  encodeBagTag,
  fetchPendingTagging,
  PENDING_TAGGING_QUERY_KEY,
} from "@/services/bags/taggingClient";
import { useAppStore } from "@/store/appStore";
import type { TaggingBag, TaggingXrayStatus } from "@/types/tagging";

export const Route = createFileRoute("/tagging")({
  head: () => ({ meta: [{ title: "Tagging Station · BELTrak" }] }),
  component: TaggingStation,
});

function relativeFlagTime(flaggedAt: string, now: number) {
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(flaggedAt).getTime()) / 1_000));
  if (elapsedSeconds < 60) return "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Not supplied";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const XRAY_STATUS_STYLES: Record<TaggingXrayStatus, string> = {
  AVAILABLE: "border-success/30 bg-success/10 text-success",
  PENDING: "border-warning/30 bg-warning/10 text-warning",
  NOT_FOUND: "border-muted-foreground/30 bg-muted text-muted-foreground",
  FAILED: "border-danger/30 bg-danger/10 text-danger",
  ARCHIVED: "border-border bg-background text-muted-foreground",
  NOT_REQUESTED: "border-border bg-background text-muted-foreground",
};

const XRAY_STATUS_LABELS: Record<TaggingXrayStatus, string> = {
  AVAILABLE: "Available",
  PENDING: "Pending",
  NOT_FOUND: "Missing",
  FAILED: "Failed",
  ARCHIVED: "Archived",
  NOT_REQUESTED: "Not requested",
};

function TaggingStation() {
  const storeBags = useAppStore((state) => state.bags);
  const { workspaceMode } = useWorkspaceMode();
  const queryClient = useQueryClient();
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [epc, setEpc] = useState("");
  const [manualLookup, setManualLookup] = useState("");
  const [now, setNow] = useState(Date.now());
  const [confirmedTagged, setConfirmedTagged] = useState<TaggingBag[]>([]);
  const epcInputRef = useRef<HTMLInputElement>(null);

  const pendingQuery = useQuery({
    queryKey: PENDING_TAGGING_QUERY_KEY,
    queryFn: fetchPendingTagging,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const encodeMutation = useMutation({
    mutationFn: ({ bagId, nextEpc }: { bagId: string; nextEpc: string }) =>
      encodeBagTag(bagId, nextEpc),
  });
  const pendingBags = pendingQuery.data ?? [];
  const storeRecentlyTagged = storeBags
    .filter((bag) => bag.taggedAt && bag.epc)
    .sort(
      (first, second) =>
        new Date(second.taggedAt ?? 0).getTime() - new Date(first.taggedAt ?? 0).getTime(),
    )
    .slice(0, 10);
  const recentlyTagged = [...confirmedTagged, ...storeRecentlyTagged]
    .filter(
      (bag, index, allBags) => allBags.findIndex((candidate) => candidate.id === bag.id) === index,
    )
    .sort(
      (first, second) =>
        new Date(second.taggedAt ?? 0).getTime() - new Date(first.taggedAt ?? 0).getTime(),
    )
    .slice(0, 10);
  const selectedBag = selectedBagId
    ? (pendingBags.find((bag) => bag.id === selectedBagId) ?? null)
    : null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedBag?.status === "IDENTIFIED") {
      setEpc("");
      window.requestAnimationFrame(() => epcInputRef.current?.focus());
    }
  }, [selectedBag?.id, selectedBag?.status]);

  function selectBag(bagId: string) {
    setSelectedBagId(bagId);
  }

  function handleLookup() {
    const query = manualLookup.trim().toUpperCase();
    const bag = pendingBags.find(
      (candidate) =>
        candidate.id.toUpperCase() === query || candidate.bhsUid.toUpperCase() === query,
    );
    if (!bag) {
      toast.error(`No pending bag found for "${manualLookup}"`);
      return;
    }
    selectBag(bag.id);
    setManualLookup("");
  }

  async function handleEncode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBag) return;

    try {
      const taggedBag = await encodeMutation.mutateAsync({
        bagId: selectedBag.id,
        nextEpc: epc,
      });
      setConfirmedTagged((current) => [
        taggedBag,
        ...current.filter((bag) => bag.id !== taggedBag.id),
      ]);
      queryClient.setQueryData<TaggingBag[]>(PENDING_TAGGING_QUERY_KEY, (current = []) =>
        current.filter((bag) => bag.id !== taggedBag.id),
      );
      setSelectedBagId(null);
      setEpc("");
      void queryClient.invalidateQueries({ queryKey: PENDING_TAGGING_QUERY_KEY });
      toast.success(`Tagged ${taggedBag.id} — EPC bound`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to encode tag");
      epcInputRef.current?.focus();
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Tagging Station"
        subtitle="Encode and verify RFID tags for newly flagged suspect bags."
        actions={
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
            <span className="text-lg font-semibold text-warning">{pendingBags.length}</span>
            <span className="text-[12px] font-medium">
              bag{pendingBags.length === 1 ? "" : "s"} pending
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        <Panel
          title={`Incoming Suspect Bags · ${pendingBags.length} pending`}
          className="col-span-12 lg:col-span-4"
        >
          <div className="mb-3 flex gap-1.5">
            <input
              placeholder="Scan Bag ID / BHS UID"
              value={manualLookup}
              onChange={(event) => setManualLookup(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleLookup()}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2.5 font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={handleLookup}
              className="rounded-md border border-border px-3 hover:bg-accent"
              aria-label="Find bag"
            >
              <ScanLine className="size-4" />
            </button>
          </div>

          {pendingQuery.isLoading ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              Loading the authoritative queue…
            </div>
          ) : pendingQuery.isError ? (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 p-3 text-[12px] text-danger"
            >
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="size-4" />
                Unable to load the pending queue
              </div>
              <p className="mt-1">
                {pendingQuery.error instanceof Error
                  ? pendingQuery.error.message
                  : "Tagging API request failed"}
              </p>
              <button
                type="button"
                onClick={() => void pendingQuery.refetch()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-danger/30 px-2.5 py-1.5 font-medium"
              >
                <RefreshCw className="size-3.5" />
                Retry
              </button>
            </div>
          ) : pendingBags.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              No bags pending — waiting for suspect flags
            </div>
          ) : (
            <ul className="max-h-120 space-y-2 overflow-y-auto">
              {pendingBags.map((bag) => (
                <li key={bag.id}>
                  <button
                    type="button"
                    onClick={() => selectBag(bag.id)}
                    className={`w-full rounded-md border p-3 text-left transition ${
                      selectedBagId === bag.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-accent/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-[13px] font-semibold">{bag.id}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {bag.flightNo} · {bag.threatType ?? "Suspect Bag"}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {bag.bhsUid}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock3 className="size-3" />
                          Flagged {relativeFlagTime(bag.flaggedAt, now)}
                        </div>
                      </div>
                      <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">
                        Encode
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={selectedBag ? `Encode Tag · ${selectedBag.id}` : "Encode Tag"}
          className="col-span-12 lg:col-span-5"
        >
          {selectedBag ? (
            <div className="space-y-5">
              <dl className="grid grid-cols-3 gap-y-2 rounded-md border border-border bg-background/40 p-3 text-[12px]">
                <dt className="text-muted-foreground">Bag ID</dt>
                <dd className="col-span-2 font-mono font-semibold">{selectedBag.id}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="col-span-2 font-mono">{selectedBag.sourceSystem}</dd>
                <dt className="text-muted-foreground">BHS UID</dt>
                <dd className="col-span-2 font-mono">{selectedBag.bhsUid}</dd>
                <dt className="text-muted-foreground">IATA code</dt>
                <dd className="col-span-2 font-mono">{selectedBag.iataCode ?? "Not supplied"}</dd>
                <dt className="text-muted-foreground">IATA origin</dt>
                <dd className="col-span-2 font-mono">{selectedBag.iataOrigin ?? "Not supplied"}</dd>
                <dt className="text-muted-foreground">Flight</dt>
                <dd className="col-span-2 font-mono">{selectedBag.flightNo}</dd>
                <dt className="text-muted-foreground">Passenger</dt>
                <dd className="col-span-2">{selectedBag.passengerName ?? "Not supplied"}</dd>
                <dt className="text-muted-foreground">Threat type</dt>
                <dd className="col-span-2 text-warning">
                  {selectedBag.threatType ?? "Suspect Bag"}
                </dd>
                <dt className="text-muted-foreground">Threat level</dt>
                <dd className="col-span-2">{selectedBag.threatLevel ?? "Not supplied"}</dd>
                <dt className="text-muted-foreground">Station</dt>
                <dd className="col-span-2">{selectedBag.screeningStation ?? "Not supplied"}</dd>
                <dt className="text-muted-foreground">Screened</dt>
                <dd className="col-span-2">{formatDateTime(selectedBag.screenedAt)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="col-span-2 font-mono">{selectedBag.status}</dd>
                <dt className="text-muted-foreground">RFID status</dt>
                <dd className="col-span-2">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      selectedBag.rfidState === "ENCODED"
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-warning/30 bg-warning/10 text-warning"
                    }`}
                  >
                    {selectedBag.rfidState === "ENCODED" ? "Encoded" : "Not encoded"}
                  </span>
                </dd>
              </dl>

              <div className="rounded-md border border-border bg-background/40 p-3 text-[12px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">X-ray status</span>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      XRAY_STATUS_STYLES[selectedBag.xrayStatus]
                    }`}
                  >
                    {XRAY_STATUS_LABELS[selectedBag.xrayStatus]}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {selectedBag.xrayViewCount} view
                  {selectedBag.xrayViewCount === 1 ? "" : "s"} available. X-ray availability does
                  not block RFID encoding.
                </div>
              </div>

              {selectedBag.status === "IDENTIFIED" ? (
                <form onSubmit={handleEncode} className="space-y-3">
                  <label className="block text-[12px] font-medium">
                    EPC
                    <input
                      ref={epcInputRef}
                      value={epc}
                      onChange={(event) => setEpc(event.target.value.toUpperCase())}
                      placeholder="Scan or enter EPC"
                      autoComplete="off"
                      className="mt-1.5 w-full rounded-md border border-primary/40 bg-background px-4 py-4 font-mono text-lg tracking-wide outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {workspaceMode === "Developer" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEpc(`EPC-${selectedBag.id.slice(-6)}`);
                          epcInputRef.current?.focus();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent"
                      >
                        <WandSparkles className="size-3.5" />
                        Generate EPC
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={encodeMutation.isPending || !epc.trim()}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      <Tag className="size-4" />
                      {encodeMutation.isPending ? "Encoding & verifying…" : "Encode & verify"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-success">
                  Tagged {selectedBag.id} — {selectedBag.epc}
                </div>
              )}
            </div>
          ) : (
            <div className="py-16 text-center text-[13px] text-muted-foreground">
              <Tag className="mx-auto mb-2 size-8 opacity-40" />
              Select a bag from the incoming queue
            </div>
          )}
        </Panel>

        <Panel title="Recently Tagged" className="col-span-12 lg:col-span-3">
          {recentlyTagged.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              No bags tagged yet
            </div>
          ) : (
            <ul className="max-h-120 space-y-2 overflow-y-auto">
              {recentlyTagged.map((bag) => (
                <li key={bag.id} className="rounded-md border border-border p-3 text-[11px]">
                  <div className="font-mono font-semibold">{bag.id}</div>
                  <div className="mt-1 text-muted-foreground">{bag.flightNo}</div>
                  <div className="mt-2 break-all font-mono text-success">{bag.epc}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
