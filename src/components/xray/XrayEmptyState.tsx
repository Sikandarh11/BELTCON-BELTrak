import type { ReactNode } from "react";
import { AlertTriangle, Clock3, ImageOff, ScanSearch, Unplug, type LucideIcon } from "lucide-react";

export type XrayEmptyStateKind =
  | "no-bag"
  | "no-bhs-uid"
  | "not-requested"
  | "pending"
  | "missing"
  | "failed"
  | "archived"
  | "error";

interface XrayEmptyStateProps {
  kind: XrayEmptyStateKind;
  title?: string;
  description?: string;
  action?: ReactNode;
  showManualInspectionWarning?: boolean;
}

const defaults: Record<
  XrayEmptyStateKind,
  {
    title: string;
    description: string;
    icon: LucideIcon;
    iconClassName: string;
  }
> = {
  "no-bag": {
    title: "No bag selected",
    description: "Select a bag pending recheck to review its X-ray scan.",
    icon: ScanSearch,
    iconClassName: "text-muted-foreground",
  },
  "no-bhs-uid": {
    title: "No BHS UID",
    description: "This bag cannot be matched to an HBSS scan automatically.",
    icon: Unplug,
    iconClassName: "text-warning",
  },
  "not-requested": {
    title: "No X-ray scan stored",
    description: "Retrieve the latest scan from HBSS when operationally appropriate.",
    icon: ScanSearch,
    iconClassName: "text-muted-foreground",
  },
  pending: {
    title: "X-ray scan pending",
    description: "HBSS is still processing the scan. You can check again later.",
    icon: Clock3,
    iconClassName: "text-warning",
  },
  missing: {
    title: "X-ray scan not found",
    description: "HBSS has no scan matching this bag's BHS UID.",
    icon: ImageOff,
    iconClassName: "text-muted-foreground",
  },
  failed: {
    title: "X-ray retrieval failed",
    description: "HBSS reported a failure while retrieving this scan.",
    icon: AlertTriangle,
    iconClassName: "text-danger",
  },
  archived: {
    title: "X-ray scan archived",
    description: "The stored HBSS scan is archived and is not available as a current image.",
    icon: ImageOff,
    iconClassName: "text-muted-foreground",
  },
  error: {
    title: "X-ray service unavailable",
    description: "The scan could not be loaded. Check the connection and try again.",
    icon: AlertTriangle,
    iconClassName: "text-danger",
  },
};

export function XrayEmptyState({
  kind,
  title,
  description,
  action,
  showManualInspectionWarning = false,
}: XrayEmptyStateProps) {
  const config = defaults[kind];
  const Icon = config.icon;

  return (
    <div className="flex min-h-112 flex-col items-center justify-center bg-muted/20 px-6 py-12 text-center">
      <div className="rounded-full border border-border bg-background p-4 shadow-sm">
        <Icon className={`size-8 ${config.iconClassName}`} aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold">{title ?? config.title}</h2>
      <p className="mt-1 max-w-md text-[12px] text-muted-foreground">
        {description ?? config.description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
      {showManualInspectionWarning ? (
        <div
          className="mt-5 max-w-lg rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-left text-[12px] text-warning"
          role="status"
        >
          X-ray imagery is not required to continue. Perform emergency manual inspection when
          needed, record officer notes, and use the existing resolution actions below.
        </div>
      ) : null}
    </div>
  );
}
