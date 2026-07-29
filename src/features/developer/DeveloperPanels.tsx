import { Link } from "@tanstack/react-router";
import { DatabaseZap, Radio, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { useSession } from "@/auth/SessionContext";
import { Panel } from "@/components/AppLayout";
import { useRfidTrackableBags } from "@/services/bags/rfidTrackableClient";

const developerLinks = [
  ["/dev/console", "Console"],
  ["/dev/api", "API Explorer"],
  ["/dev/simulator", "Simulator"],
  ["/dev/events", "Event Stream"],
  ["/dev/flags", "Feature Flags"],
  ["/dev/logs", "Logs"],
  ["/dev/db", "DB Inspector"],
] as const;

export function DeveloperSubnav() {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Developer navigation">
      {developerLinks.map(([to, label]) => (
        <Link
          key={to}
          to={to}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function SessionDiagnosticsPanel() {
  const session = useSession();
  return (
    <Panel title="Session diagnostics">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Canonical role</dt>
        <dd>{session.role}</dd>
        <dt className="text-muted-foreground">User ID</dt>
        <dd className="break-all font-mono text-xs">{session.id}</dd>
        <dt className="text-muted-foreground">Permissions</dt>
        <dd>{session.permissions.length}</dd>
      </dl>
    </Panel>
  );
}

export function RuntimeDiagnosticsPanel() {
  return (
    <Panel title="Runtime diagnostics">
      <p className="text-sm text-muted-foreground">
        Browser diagnostics are local only. BELTCON SBTS operational records are not inspected from
        a browser store.
      </p>
    </Panel>
  );
}

export function RealtimeDiagnosticsPanel() {
  return (
    <Panel title="Realtime diagnostics">
      <p className="text-sm text-muted-foreground">
        Realtime invalidation is deferred pending verified Supabase publication and RLS settings.
        Active operational queries use targeted refetch intervals instead.
      </p>
    </Panel>
  );
}

export function StoreDiagnosticsPanel() {
  return (
    <Panel title="UI preference store">
      <p className="text-sm text-muted-foreground">
        The Zustand store contains UI preferences only. It has no bags, alarms, readers, RFID
        events, resolutions, audit records, or report data.
      </p>
    </Panel>
  );
}

export function ErrorLogPanel() {
  return (
    <Panel title="Client errors">
      <p className="text-sm text-muted-foreground">
        Client error history is intentionally not an operational audit log. Use server-backed audit
        events once the Phase 9 read model is available.
      </p>
    </Panel>
  );
}

export function FeatureFlagsPanel() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(window.localStorage.getItem("sbts.flags") === "true");
  }, []);

  function update(next: boolean) {
    setEnabled(next);
    window.localStorage.setItem("sbts.flags", String(next));
  }

  return (
    <Panel title="Client feature preferences">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => update(event.target.checked)}
        />
        Enable local developer preference flag
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        This preference neither grants access nor changes server authorization.
      </p>
    </Panel>
  );
}

export function EventStreamPanel() {
  const trackable = useRfidTrackableBags();
  return (
    <Panel title="RFID simulator data">
      {trackable.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tagged bags…</p>
      ) : null}
      {trackable.isError ? (
        <button
          type="button"
          onClick={() => void trackable.refetch()}
          className="text-sm text-danger underline"
        >
          Retry loading authoritative RFID bags
        </button>
      ) : null}
      {trackable.data ? (
        <div className="flex items-center gap-3 text-sm">
          <Radio className="size-4 text-primary" />
          {trackable.data.length} tagged bag{trackable.data.length === 1 ? "" : "s"} available to
          the authoritative RFID simulator.
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        RFID event history will receive a dedicated server read model in Phase 9. Test reads are
        submitted only through the server-backed simulator.
      </p>
    </Panel>
  );
}

export function DbInspectorPanel() {
  return (
    <Panel title="Database inspector">
      <div className="flex gap-3 text-sm text-muted-foreground">
        <DatabaseZap className="size-4 shrink-0" />
        Browser inspection of hydrated operational tables was removed. Use authenticated APIs and
        audited support tooling instead.
      </div>
    </Panel>
  );
}

export function ApiExplorerPanel() {
  return (
    <Panel title="API explorer">
      <div className="flex gap-3 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0" />
        API exploration must use a dedicated, permission-aware support tool. This page does not send
        browser-crafted operational requests.
      </div>
    </Panel>
  );
}

export function DeveloperConsoleGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SessionDiagnosticsPanel />
      <RuntimeDiagnosticsPanel />
      <RealtimeDiagnosticsPanel />
      <StoreDiagnosticsPanel />
    </div>
  );
}
