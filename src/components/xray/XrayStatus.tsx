import { AlertCircle, Clock3, Images, RotateCw } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import type { XrayScan } from "@/types/xray";
import { getXrayDisplayStatus, type XrayDisplayStatus } from "./xrayStatusModel";

interface XrayStatusProps {
  scan: XrayScan | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const statusClasses: Record<XrayDisplayStatus, string> = {
  Available: "border-success/30 bg-success/10 text-success",
  Pending: "border-warning/30 bg-warning/10 text-warning",
  Missing: "border-muted-foreground/30 bg-muted text-muted-foreground",
  Failed: "border-danger/30 bg-danger/10 text-danger",
  Archived: "border-muted-foreground/30 bg-muted text-muted-foreground",
  "Not requested": "border-border bg-background text-muted-foreground",
};

function formatCapturedAt(capturedAt: string | null) {
  if (!capturedAt) return "Not supplied";
  const timestamp = new Date(capturedAt);
  return Number.isNaN(timestamp.getTime()) ? capturedAt : timestamp.toLocaleString();
}

export function XrayStatus({ scan, loading = false, error = null, onRetry }: XrayStatusProps) {
  if (loading) {
    return (
      <div
        className="space-y-2 rounded-md border border-border bg-background/40 p-3"
        aria-label="Loading X-ray status"
      >
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
    );
  }

  const status = getXrayDisplayStatus(scan);

  return (
    <div className="rounded-md border border-border bg-background/40 p-3 text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <Images className="size-4 text-muted-foreground" aria-hidden="true" />
          X-ray scan
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClasses[status]}`}
        >
          {status}
        </span>
      </div>

      {scan ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-mono">{scan.sourceSystem}</dd>
          <dt className="text-muted-foreground">Views</dt>
          <dd>{scan.images.length}</dd>
          <dt className="text-muted-foreground">Captured</dt>
          <dd>{formatCapturedAt(scan.capturedAt)}</dd>
        </dl>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No locally stored scan has been requested for this bag.
        </p>
      )}

      {error ? (
        <div
          className="mt-3 flex items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-warning"
          role="status"
        >
          <span className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-warning/30 px-2 py-1 font-medium hover:bg-warning/10"
              aria-label="Check X-ray status again"
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      ) : scan?.status === "PENDING" ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
          <Clock3 className="size-3" aria-hidden="true" />
          HBSS is still processing this scan.
        </p>
      ) : null}
    </div>
  );
}
