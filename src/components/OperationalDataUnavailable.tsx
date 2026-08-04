import { Link } from "@tanstack/react-router";
import { DatabaseZap, RefreshCw } from "lucide-react";

import { PageHeader, Panel } from "@/components/AppLayout";

/**
 * Honest state for surfaces that are not enabled in this release.
 * It deliberately never substitutes seed or browser-persisted operational
 * records for an API response.
 */
export function OperationalDataUnavailable({
  title,
  subtitle,
  feature,
  action,
}: {
  title: string;
  subtitle: string;
  feature: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="p-6">
      <PageHeader title={title} subtitle={subtitle} />
      <Panel title="Module not enabled">
        <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <DatabaseZap className="size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">Module not enabled</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            This module is not enabled in the current release. Use the available Tagging, Alarms
            and Recheck modules for operational work.
          </p>
          {action ? (
            <Link
              to={action.to}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <RefreshCw className="size-4" />
              {action.label}
            </Link>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
