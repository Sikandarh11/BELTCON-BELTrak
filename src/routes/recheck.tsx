import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, PauseCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/auth/SessionContext";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { RoleGate } from "@/components/RoleGate";
import { Skeleton } from "@/components/ui/skeleton";
import { XrayEmptyState } from "@/components/xray/XrayEmptyState";
import { XrayViewer } from "@/components/xray/XrayViewer";
import { bagService } from "@/services/bagService";
import { roleIsAtLeast } from "@/services/roles";
import { getXrayForBag, refreshXrayForBag } from "@/services/xray/xrayClient";
import { useAppStore } from "@/store/appStore";
import type { Bag, ResolutionAction, XrayScan } from "@/types";

export const Route = createFileRoute("/recheck")({
  head: () => ({ meta: [{ title: "Recheck Station · BELTrak" }] }),
  component: Recheck,
});

interface RecheckXrayContentProps {
  bag: Bag | null;
  scan: XrayScan | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}

function RecheckXrayContent({ bag, scan, loading, error, onReload }: RecheckXrayContentProps) {
  if (!bag) {
    return <XrayEmptyState kind="no-bag" />;
  }

  if (!bag.bhsUid) {
    return <XrayEmptyState kind="no-bhs-uid" showManualInspectionWarning />;
  }

  if (loading) {
    return (
      <div className="flex min-h-112 flex-col justify-between bg-muted/20 p-6" aria-live="polite">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-12" />
        </div>
        <Skeleton className="mx-auto h-72 w-4/5" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
        <span className="sr-only">Loading the latest X-ray scan</span>
      </div>
    );
  }

  if (error) {
    return (
      <XrayEmptyState
        kind="error"
        description={error}
        action={
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] font-medium hover:bg-accent"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Load stored scan again
          </button>
        }
        showManualInspectionWarning
      />
    );
  }

  if (!scan) {
    return <XrayEmptyState kind="not-requested" showManualInspectionWarning />;
  }

  switch (scan.status) {
    case "AVAILABLE":
      return <XrayViewer bagId={bag.id} scan={scan} />;
    case "PENDING":
      return <XrayEmptyState kind="pending" showManualInspectionWarning />;
    case "NOT_FOUND":
      return <XrayEmptyState kind="missing" showManualInspectionWarning />;
    case "FAILED":
      return (
        <XrayEmptyState
          kind="failed"
          description={scan.errorMessage ?? undefined}
          showManualInspectionWarning
        />
      );
    case "ARCHIVED":
      return (
        <XrayEmptyState
          kind="missing"
          title="X-ray scan archived"
          description="The latest stored scan is archived and is not available for review."
          showManualInspectionWarning
        />
      );
  }
}

function Recheck() {
  const session = useSession();
  const bags = useAppStore((state) => state.bags);
  const alarms = useAppStore((state) => state.alarms);
  const events = useAppStore((state) => state.events);

  const [searchTerm, setSearchTerm] = useState("");
  const [notes, setNotes] = useState(
    "Organic dense mass located in left quadrant. Recommend physical search.",
  );
  const [xrayScan, setXrayScan] = useState<XrayScan | null>(null);
  const [xrayLoading, setXrayLoading] = useState(false);
  const [xrayRefreshing, setXrayRefreshing] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [xrayLookupAttempt, setXrayLookupAttempt] = useState(0);
  const activeXrayBagIdRef = useRef<string | null>(null);

  const recheckBags = bags.filter((bag) => bag.status === "AT_RECHECK");
  const currentBag =
    (searchTerm
      ? recheckBags.find((bag) => bag.id === searchTerm || bag.epc === searchTerm)
      : recheckBags[0]) ?? null;
  const currentXrayBagId = currentBag?.id ?? null;
  const currentXrayBhsUid = currentBag?.bhsUid ?? null;

  const bagEvents = currentBag
    ? events
        .filter((event) => event.epc === currentBag.epc)
        .sort(
          (first, second) =>
            new Date(second.firstSeen).getTime() - new Date(first.firstSeen).getTime(),
        )
    : [];

  const canRefreshXray = roleIsAtLeast(session.role, "Operations Officer");

  useEffect(() => {
    let cancelled = false;
    activeXrayBagIdRef.current = currentXrayBagId;
    setXrayScan(null);
    setXrayError(null);

    if (!currentXrayBagId || !currentXrayBhsUid) {
      setXrayLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setXrayLoading(true);
    void getXrayForBag(currentXrayBagId)
      .then((scan) => {
        if (!cancelled) {
          setXrayScan(scan);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setXrayError(error instanceof Error ? error.message : "Unable to load the X-ray scan");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setXrayLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentXrayBagId, currentXrayBhsUid, xrayLookupAttempt]);

  async function handleXrayRefresh() {
    if (!currentBag || !currentBag.bhsUid || xrayRefreshing || !canRefreshXray) {
      return;
    }

    const bagId = currentBag.id;
    setXrayRefreshing(true);
    setXrayError(null);

    try {
      const refreshedScan = await refreshXrayForBag(bagId);
      if (activeXrayBagIdRef.current === bagId) {
        setXrayScan(refreshedScan);
      }
      toast.success(`X-ray status updated for ${bagId}`);
    } catch (refreshError) {
      try {
        const latestScan = await getXrayForBag(bagId);
        if (activeXrayBagIdRef.current === bagId) {
          setXrayScan(latestScan);
          setXrayError(null);
        }
      } catch (reloadError) {
        if (activeXrayBagIdRef.current === bagId) {
          setXrayError(
            reloadError instanceof Error
              ? reloadError.message
              : "Unable to reload the stored X-ray scan",
          );
        }
      }

      toast.error(
        refreshError instanceof Error ? refreshError.message : "Unable to retrieve from HBSS",
      );
    } finally {
      setXrayRefreshing(false);
    }
  }

  async function handleResolve(action: ResolutionAction) {
    if (!currentBag) return;
    try {
      await bagService.resolve(currentBag.id, {
        action,
        officer: `${session.firstName} ${session.lastName}`.trim() || session.id,
        notes,
      });
      setSearchTerm("");
      toast.success(`${currentBag.id} resolved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  }

  return (
    <RoleGate userRole={session.role} requiredRole="Operations Officer" pageName="Recheck Station">
      <div className="p-6">
        <PageHeader
          title="Recheck Station · Bay 2"
          subtitle={`Customs officer secondary inspection${currentBag ? ` · ${currentBag.id}` : ""}`}
          actions={<StatusPill status={currentBag ? "ACTIVE" : "CLOSED"} />}
        />

        <div className="mb-4 flex gap-2">
          <input
            placeholder="Search by IATA code or EPC..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="min-h-[48px] flex-1 rounded-md border border-border bg-background px-3 py-3 font-mono text-[14px]"
          />
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent"
          >
            Show next pending
          </button>
          <span className="self-center text-[12px] text-muted-foreground">
            {recheckBags.length} bag{recheckBags.length !== 1 ? "s" : ""} pending
          </span>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <Panel
            title="X-Ray Viewer"
            className="col-span-12 overflow-hidden p-0! xl:col-span-8"
            action={
              currentBag?.bhsUid && canRefreshXray ? (
                <button
                  type="button"
                  onClick={() => void handleXrayRefresh()}
                  disabled={xrayRefreshing}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Retrieve X-ray from HBSS for bag ${currentBag.id}`}
                >
                  <RefreshCw
                    className={`size-3.5 ${xrayRefreshing ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {xrayRefreshing ? "Retrieving…" : "Retrieve from HBSS"}
                </button>
              ) : null
            }
          >
            <RecheckXrayContent
              bag={currentBag}
              scan={xrayScan}
              loading={xrayLoading}
              error={xrayError}
              onReload={() => setXrayLookupAttempt((attempt) => attempt + 1)}
            />
          </Panel>

          <div className="col-span-12 space-y-4 xl:col-span-4">
            <Panel title="Bag Details">
              {currentBag ? (
                <dl className="grid grid-cols-3 gap-y-2 text-[13px]">
                  <dt className="text-[12px] text-muted-foreground">Bag ID</dt>
                  <dd className="col-span-2 font-mono">{currentBag.id}</dd>
                  <dt className="text-[12px] text-muted-foreground">BHS UID</dt>
                  <dd className="col-span-2 font-mono">{currentBag.bhsUid ?? "—"}</dd>
                  <dt className="text-[12px] text-muted-foreground">Flight</dt>
                  <dd className="col-span-2 font-mono">{currentBag.flightNo}</dd>
                  <dt className="text-[12px] text-muted-foreground">Passenger</dt>
                  <dd className="col-span-2">{currentBag.passengerName ?? "—"}</dd>
                  <dt className="text-[12px] text-muted-foreground">Passport</dt>
                  <dd className="col-span-2 font-mono">—</dd>
                  <dt className="text-[12px] text-muted-foreground">Reason</dt>
                  <dd className="col-span-2 text-warning">
                    {alarms
                      .find((alarm) => alarm.bagId === currentBag.id)
                      ?.zone.replace(/_/g, " ") ?? "Secondary inspection"}
                  </dd>
                  <dt className="text-[12px] text-muted-foreground">Status</dt>
                  <dd className="col-span-2">
                    <StatusPill
                      status={currentBag.status === "ALARMED" ? "ACTIVE" : "ACKNOWLEDGED"}
                    />
                  </dd>
                </dl>
              ) : (
                <div className="py-6 text-center text-[12px] text-muted-foreground">
                  No bags pending recheck
                </div>
              )}
            </Panel>

            <Panel title={`Movement Timeline${currentBag ? ` · ${currentBag.id}` : ""}`}>
              {bagEvents.length > 0 ? (
                <ol className="max-h-48 space-y-2 overflow-y-auto text-[12px]">
                  {bagEvents.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-center gap-2 border-b border-border py-1 last:border-0"
                    >
                      <span className="w-14 font-mono text-muted-foreground">
                        {new Date(event.firstSeen).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span
                        className={`size-2 rounded-full ${
                          event.eventType.includes("ALARM") || event.eventType.includes("EXIT")
                            ? "bg-danger"
                            : "bg-info"
                        }`}
                      />
                      <span className="flex-1">{event.zone.replace(/_/g, " ")}</span>
                      <span className="font-mono text-muted-foreground">×{event.readCount}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="py-4 text-center text-[12px] text-muted-foreground">
                  No events recorded
                </div>
              )}
            </Panel>

            <Panel title="Officer Notes">
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded border border-border bg-background p-2 text-[12.5px]"
              />
            </Panel>

            <div className="grid grid-cols-1 gap-2">
              {currentBag ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleResolve("CLEARED")}
                    className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-md bg-success/90 px-4 py-3.5 text-[15px] font-medium text-primary-foreground hover:bg-success"
                  >
                    <CheckCircle2 className="size-4" />
                    Cleared
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResolve("NOT_CLEARED")}
                    className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-md bg-warning/90 px-4 py-3.5 text-[15px] font-medium text-primary-foreground hover:bg-warning"
                  >
                    <PauseCircle className="size-4" />
                    Not Cleared — Hold
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResolve("DUTY_COLLECTED")}
                    className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-md bg-info/90 px-4 py-3.5 text-[15px] font-medium text-primary-foreground hover:bg-info"
                  >
                    <CheckCircle2 className="size-4" />
                    Duty Collected
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResolve("PROHIBITED_ITEM_SEIZED")}
                    className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-md bg-danger px-4 py-3.5 text-[15px] font-medium text-destructive-foreground hover:bg-danger/90"
                  >
                    <AlertTriangle className="size-4" />
                    Seized — Prohibited Item
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResolve("ESCALATED")}
                    className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-md bg-amber-600 px-4 py-3.5 text-[15px] font-medium text-white hover:bg-amber-700"
                  >
                    <ArrowUpRight className="size-4" />
                    Escalate to Supervisor
                  </button>
                </>
              ) : (
                <div className="py-4 text-center text-[12px] text-muted-foreground">
                  No bag selected
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </RoleGate>
  );
}
