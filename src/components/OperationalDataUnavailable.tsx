import { Link } from "@tanstack/react-router";
import { DatabaseZap, RefreshCw } from "lucide-react";

import { PageHeader, Panel } from "@/components/AppLayout";

/**
 * Honest Phase 8 state for surfaces whose server-backed read model is planned
 * for Phase 9.  It deliberately never substitutes seed or browser-persisted
 * operational records for an API response.
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
      <Panel title="Authoritative data unavailable">
        <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <DatabaseZap className="size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">{feature} read model is not available yet</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            BELTCON SBTS no longer displays browser-persisted or seeded operational records on this
            page. A server-backed read model is planned for Phase 9.
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
