import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Braces,
  Clipboard,
  Database,
  Flag,
  Radio,
  RefreshCw,
  Send,
  Terminal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";

import { useAuthSession, useSession, useWorkspaceMode } from "@/auth/SessionContext";
import { roleIsAtLeast } from "@/auth/canonicalRoles";
import { Panel, StatusPill } from "@/components/AppLayout";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clearCapturedErrors,
  getCapturedErrors,
  subscribeToCapturedErrors,
} from "@/lib/error-capture";
import { eventService } from "@/services/eventService";
import { persistenceService } from "@/services/persistenceService";
import { getRealtimeSnapshot, subscribeToRealtimeStatus } from "@/services/realtimeService";
import { useAppStore } from "@/store/appStore";

const DEV_LINKS = [
  { to: "/dev/console", label: "Console", icon: Terminal },
  { to: "/dev/simulator", label: "Simulator", icon: Radio },
  { to: "/dev/events", label: "Events", icon: Activity },
  { to: "/dev/flags", label: "Flags", icon: Flag },
  { to: "/dev/logs", label: "Logs", icon: Braces },
  { to: "/dev/db", label: "DB", icon: Database },
  { to: "/dev/api", label: "API", icon: Send },
] as const;

const EMPTY_ERRORS = [] as const;

function formatRelativeExpiry(value: string) {
  const difference = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(difference)) return "unknown";
  if (difference <= 0) return "expired";

  const minutes = Math.floor(difference / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (hours > 0) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}`;
}

async function copyText(value: string, successMessage = "Copied") {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Unable to copy to clipboard");
  }
}

export function DeveloperSubnav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav aria-label="Developer workspace" className="mb-4 flex flex-wrap gap-2">
      {DEV_LINKS.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition ${
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-panel/60 hover:bg-accent"
            }`}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SessionDiagnosticsPanel() {
  const { user, tokenExpiry } = useAuthSession();
  const { workspaceMode } = useWorkspaceMode();

  const sessionJson = JSON.stringify({ user, workspaceMode, tokenExpiry }, null, 2);

  return (
    <Panel
      title="Session"
      action={
        <button
          type="button"
          onClick={() => void copyText(sessionJson, "Session JSON copied")}
          className="inline-flex items-center gap-1 text-[10px] text-primary"
        >
          <Clipboard className="size-3" />
          Copy JSON
        </button>
      }
      className="h-full"
    >
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[12px]">
        <dt className="text-muted-foreground">Canonical role</dt>
        <dd>{user.role}</dd>
        <dt className="text-muted-foreground">Workspace mode</dt>
        <dd>{workspaceMode}</dd>
        <dt className="text-muted-foreground">Token expiry</dt>
        <dd>
          <span className="block font-mono">{new Date(tokenExpiry).toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeExpiry(tokenExpiry)}
          </span>
        </dd>
        <dt className="text-muted-foreground">User ID</dt>
        <dd className="break-all font-mono">{user.id}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd className="break-all">{user.email}</dd>
      </dl>
    </Panel>
  );
}

export function RuntimeDiagnosticsPanel() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  const redactedSupabaseUrl = supabaseUrl ? `${supabaseUrl.slice(0, 8)}...` : "not configured";
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? import.meta.env.VITE_GIT_SHA ?? "unknown";

  return (
    <Panel title="Runtime" className="h-full">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[12px]">
        <dt className="text-muted-foreground">Mode</dt>
        <dd className="font-mono">{import.meta.env.MODE}</dd>
        <dt className="text-muted-foreground">Build SHA</dt>
        <dd className="break-all font-mono">{buildSha}</dd>
        <dt className="text-muted-foreground">Supabase URL</dt>
        <dd className="font-mono">{redactedSupabaseUrl}</dd>
        <dt className="text-muted-foreground">User agent</dt>
        <dd className="break-words font-mono text-[10px] leading-relaxed">
          {typeof navigator === "undefined" ? "server render" : navigator.userAgent}
        </dd>
      </dl>
    </Panel>
  );
}

export function RealtimeDiagnosticsPanel() {
  const realtime = useSyncExternalStore(
    subscribeToRealtimeStatus,
    getRealtimeSnapshot,
    getRealtimeSnapshot,
  );
  const baseline = useRef<number | null>(null);
  if (baseline.current === null) baseline.current = realtime.eventsReceived;
  const eventsSinceMount = Math.max(0, realtime.eventsReceived - baseline.current);

  return (
    <Panel title="Realtime" className="h-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground">Subscription</div>
          <div className="mt-1">
            <StatusPill
              status={
                realtime.status === "connected"
                  ? "CONNECTED"
                  : realtime.status === "connecting"
                    ? "SIMULATED"
                    : realtime.status.toUpperCase()
              }
            />
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl font-semibold text-info">{eventsSinceMount}</div>
          <div className="text-[10px] text-muted-foreground">events since mount</div>
        </div>
      </div>
    </Panel>
  );
}

export function StoreDiagnosticsPanel() {
  const bags = useAppStore((state) => state.bags);
  const alarms = useAppStore((state) => state.alarms);
  const events = useAppStore((state) => state.events);
  const readers = useAppStore((state) => state.readers);
  const auditLog = useAppStore((state) => state.auditLog);
  const [reloading, setReloading] = useState(false);

  async function reloadFromSupabase() {
    setReloading(true);
    try {
      const data = await persistenceService.loadAll();
      const current = useAppStore.getState();
      useAppStore.setState({
        bags: data.bags.length > 0 ? data.bags : current.bags,
        alarms: data.alarms,
        events: data.events,
        resolutions: data.resolutions,
        readers: data.readers.length > 0 ? data.readers : current.readers,
        hydrated: true,
      });
      toast.success("Store reloaded from Supabase");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reload failed");
    } finally {
      setReloading(false);
    }
  }

  return (
    <Panel
      title="Zustand store"
      action={
        <button
          type="button"
          disabled={reloading}
          onClick={() => void reloadFromSupabase()}
          className="inline-flex items-center gap-1 text-[10px] text-primary disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${reloading ? "animate-spin" : ""}`} />
          Reload from Supabase
        </button>
      }
      className="h-full"
    >
      <div className="grid grid-cols-5 gap-2">
        {[
          ["Bags", bags.length],
          ["Alarms", alarms.length],
          ["Events", events.length],
          ["Readers", readers.length],
          ["Audit", auditLog.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-background/40 p-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ErrorLogPanel() {
  const session = useSession();
  const errors = useSyncExternalStore(
    subscribeToCapturedErrors,
    getCapturedErrors,
    () => EMPTY_ERRORS,
  );
  const canClear = roleIsAtLeast(session.role, "System Administrator");

  function clearErrors() {
    if (!canClear) {
      toast.error("System Administrator role is required to clear diagnostics.");
      return;
    }
    clearCapturedErrors();
    toast.success("Captured errors cleared");
  }

  return (
    <Panel
      title="Recent errors"
      action={
        <button
          type="button"
          disabled={!canClear || errors.length === 0}
          onClick={clearErrors}
          className="inline-flex items-center gap-1 text-[10px] text-danger disabled:opacity-40"
        >
          <Trash2 className="size-3" />
          Clear
        </button>
      }
      className="h-full"
    >
      {errors.length > 0 ? (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {errors.map((error) => (
            <li key={error.id} className="rounded-md border border-danger/20 bg-danger/5 p-2">
              <div className="font-mono text-[11px] text-danger">{error.message}</div>
              <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                {new Date(error.at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-8 text-center text-[12px] text-muted-foreground">
          No client errors captured.
        </div>
      )}
    </Panel>
  );
}

type FeatureFlags = {
  debugOverlay: boolean;
  verboseLogs: boolean;
};

const FLAGS_KEY = "sbts.flags";
const DEFAULT_FLAGS: FeatureFlags = {
  debugOverlay: false,
  verboseLogs: false,
};

function readFeatureFlags(): FeatureFlags {
  if (typeof window === "undefined") return DEFAULT_FLAGS;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(FLAGS_KEY) ?? "{}",
    ) as Partial<FeatureFlags>;
    return {
      debugOverlay: stored.debugOverlay === true,
      verboseLogs: stored.verboseLogs === true,
    };
  } catch {
    return DEFAULT_FLAGS;
  }
}

export function FeatureFlagsPanel() {
  const session = useSession();
  const [flags, setFlags] = useState<FeatureFlags>(readFeatureFlags);
  const canMutate = roleIsAtLeast(session.role, "System Administrator");

  useEffect(() => {
    function syncFlags() {
      setFlags(readFeatureFlags());
    }
    window.addEventListener("storage", syncFlags);
    window.addEventListener("sbts:flags-change", syncFlags);
    return () => {
      window.removeEventListener("storage", syncFlags);
      window.removeEventListener("sbts:flags-change", syncFlags);
    };
  }, []);

  function updateFlag(name: keyof FeatureFlags, value: boolean) {
    if (!canMutate) {
      toast.error("System Administrator role is required to change feature flags.");
      return;
    }
    const next = { ...flags, [name]: value };
    window.localStorage.setItem(FLAGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("sbts:flags-change"));
    setFlags(next);
  }

  const definitions = [
    {
      name: "debugOverlay" as const,
      label: "Debug overlay",
      description: "Expose additional component diagnostics when supported.",
    },
    {
      name: "verboseLogs" as const,
      label: "Verbose logs",
      description: "Allow components to emit expanded client-side logging.",
    },
  ];

  return (
    <Panel title="Feature flags" className="h-full">
      <div className="space-y-3">
        {definitions.map((definition) => (
          <div
            key={definition.name}
            className="flex items-center justify-between gap-4 rounded-md border border-border bg-background/40 p-3"
          >
            <div>
              <div className="text-[12px] font-medium">{definition.label}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {definition.description}
              </div>
            </div>
            <Switch
              checked={flags[definition.name]}
              disabled={!canMutate}
              onCheckedChange={(checked) => updateFlag(definition.name, checked)}
              aria-label={`Toggle ${definition.label}`}
            />
          </div>
        ))}
        {!canMutate ? (
          <p className="text-[10px] text-warning">
            Read-only: System Administrator role required to change flags.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

type EventSeverity = "info" | "medium" | "high";

function getEventSeverity(eventType: string, zone: string): EventSeverity {
  const value = `${eventType} ${zone}`.toLowerCase();
  if (value.includes("alarm") || value.includes("escape") || value.includes("emergency")) {
    return "high";
  }
  if (value.includes("restricted") || value.includes("exit")) return "medium";
  return "info";
}

export function EventStreamPanel() {
  const session = useSession();
  const events = useAppStore((state) => state.events);
  const bags = useAppStore((state) => state.bags);
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [epc, setEpc] = useState(() => bags.find((bag) => bag.epc)?.epc ?? "");
  const [readerId, setReaderId] = useState("RDR-DEV-01");
  const [zone, setZone] = useState("ARRIVAL_HALL");
  const canMutate = roleIsAtLeast(session.role, "System Administrator");
  const eventTypes = useMemo(
    () => [...new Set(events.map((event) => event.eventType))].sort(),
    [events],
  );
  const filteredEvents = events
    .filter((event) => typeFilter === "all" || event.eventType === typeFilter)
    .filter(
      (event) =>
        severityFilter === "all" ||
        getEventSeverity(event.eventType, event.zone) === severityFilter,
    )
    .sort(
      (first, second) => new Date(second.firstSeen).getTime() - new Date(first.firstSeen).getTime(),
    )
    .slice(0, 100);

  async function fireTestEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      toast.error("System Administrator role is required to fire test events.");
      return;
    }
    const result = await eventService.ingestRead(epc.trim(), readerId.trim(), zone.trim());
    toast.info(`Test event: ${result}`);
  }

  return (
    <Panel title="Live event stream">
      <form
        onSubmit={fireTestEvent}
        className="mb-4 grid gap-2 rounded-md border border-border bg-background/40 p-3 md:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <input
          value={epc}
          onChange={(event) => setEpc(event.target.value)}
          placeholder="Registered EPC"
          className="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px]"
        />
        <input
          value={readerId}
          onChange={(event) => setReaderId(event.target.value)}
          placeholder="Reader ID"
          className="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px]"
        />
        <input
          value={zone}
          onChange={(event) => setZone(event.target.value)}
          placeholder="Zone"
          className="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px]"
        />
        <button
          type="submit"
          disabled={!canMutate}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
        >
          <Send className="size-3.5" />
          Fire test event
        </button>
      </form>

      <div className="mb-3 flex flex-wrap gap-2">
        <label className="text-[10px] text-muted-foreground">
          Type
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="ml-2 rounded border border-border bg-background px-2 py-1 text-foreground"
          >
            <option value="all">All</option>
            {eventTypes.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-muted-foreground">
          Severity
          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
            className="ml-2 rounded border border-border bg-background px-2 py-1 text-foreground"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>

      <div className="max-h-150 overflow-auto">
        <table className="w-full min-w-190 text-[11px]">
          <thead className="sticky top-0 bg-panel text-[9px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {["Time", "Type", "Severity", "EPC", "Reader", "Zone", "Reads"].map((heading) => (
                <th key={heading} className="border-b border-border px-3 py-2 text-left">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEvents.map((event) => {
              const severity = getEventSeverity(event.eventType, event.zone);
              return (
                <tr key={event.id} className="border-b border-border">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                    {new Date(event.firstSeen).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2 font-mono">{event.eventType}</td>
                  <td className="px-3 py-2 uppercase">{severity}</td>
                  <td className="px-3 py-2 font-mono">{event.epc}</td>
                  <td className="px-3 py-2 font-mono">{event.readerId}</td>
                  <td className="px-3 py-2">{event.zone.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 font-mono">{event.readCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function DbInspectorPanel() {
  const bags = useAppStore((state) => state.bags);
  const alarms = useAppStore((state) => state.alarms);
  const readers = useAppStore((state) => state.readers);
  const datasets = { bags, alarms, readers };

  return (
    <Panel title="Read-only store inspector">
      <Tabs defaultValue="bags">
        <TabsList>
          <TabsTrigger value="bags">Bags</TabsTrigger>
          <TabsTrigger value="alarms">Alarms</TabsTrigger>
          <TabsTrigger value="readers">Readers</TabsTrigger>
        </TabsList>
        {(Object.keys(datasets) as Array<keyof typeof datasets>).map((key) => (
          <TabsContent key={key} value={key}>
            <div className="max-h-160 space-y-2 overflow-y-auto">
              {datasets[key].map((row) => {
                const json = JSON.stringify(row, null, 2);
                return (
                  <div
                    key={row.id}
                    className="relative rounded-md border border-border bg-background/60 p-3"
                  >
                    <button
                      type="button"
                      onClick={() => void copyText(json, `${row.id} copied`)}
                      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-border bg-panel px-2 py-1 text-[9px]"
                    >
                      <Clipboard className="size-3" />
                      Copy row
                    </button>
                    <pre className="overflow-x-auto pr-24 text-[10px] leading-relaxed">{json}</pre>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </Panel>
  );
}

const AUTH_ENDPOINTS = [
  { path: "/api/auth/login", method: "POST", body: '{\n  "email": "",\n  "password": ""\n}' },
  {
    path: "/api/auth/register",
    method: "POST",
    body: '{\n  "firstName": "",\n  "lastName": "",\n  "email": "",\n  "password": "",\n  "confirmPassword": "",\n  "registrationKey": ""\n}',
  },
  { path: "/api/auth/session", method: "GET", body: "" },
  { path: "/api/auth/logout", method: "POST", body: "{}" },
  { path: "/api/auth/forgot-password", method: "POST", body: '{\n  "email": ""\n}' },
  { path: "/api/auth/refresh", method: "POST", body: "{}" },
] as const;

export function ApiExplorerPanel() {
  const session = useSession();
  const [endpointPath, setEndpointPath] = useState<string>(AUTH_ENDPOINTS[2].path);
  const selectedEndpoint =
    AUTH_ENDPOINTS.find((endpoint) => endpoint.path === endpointPath) ?? AUTH_ENDPOINTS[2];
  const [body, setBody] = useState<string>(selectedEndpoint.body);
  const [response, setResponse] = useState("No request sent.");
  const [sending, setSending] = useState(false);
  const canMutate = roleIsAtLeast(session.role, "System Administrator");
  const canSend = selectedEndpoint.method === "GET" || canMutate;

  async function sendRequest() {
    if (!canSend) {
      toast.error("System Administrator role is required for mutating API requests.");
      return;
    }
    setSending(true);
    try {
      const result = await fetch(selectedEndpoint.path, {
        method: selectedEndpoint.method,
        credentials: "include",
        headers:
          selectedEndpoint.method === "GET" ? undefined : { "content-type": "application/json" },
        body: selectedEndpoint.method === "GET" ? undefined : body,
      });
      const text = await result.text();
      let formattedBody = text;
      try {
        formattedBody = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Keep non-JSON response text as-is.
      }
      setResponse(`${result.status} ${result.statusText}\n\n${formattedBody}`);
    } catch (error) {
      setResponse(error instanceof Error ? (error.stack ?? error.message) : String(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel title="Auth API explorer">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-[11px] text-muted-foreground">
            Endpoint
            <select
              value={endpointPath}
              onChange={(event) => {
                const next =
                  AUTH_ENDPOINTS.find((endpoint) => endpoint.path === event.target.value) ??
                  AUTH_ENDPOINTS[2];
                setEndpointPath(next.path);
                setBody(next.body);
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground"
            >
              {AUTH_ENDPOINTS.map((endpoint) => (
                <option key={endpoint.path} value={endpoint.path}>
                  {endpoint.method} {endpoint.path}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] text-muted-foreground">
            JSON body
            <textarea
              rows={13}
              value={body}
              disabled={selectedEndpoint.method === "GET"}
              onChange={(event) => setBody(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background p-3 font-mono text-[11px] text-foreground disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            disabled={!canSend || sending}
            onClick={() => void sendRequest()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
          >
            {sending ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Send
          </button>
          {!canSend ? (
            <p className="text-[10px] text-warning">
              System Administrator role required for this mutating endpoint.
            </p>
          ) : null}
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Response</div>
          <pre className="min-h-95 overflow-auto rounded-md border border-border bg-background/70 p-3 text-[11px] leading-relaxed">
            {response}
          </pre>
        </div>
      </div>
    </Panel>
  );
}

export function DeveloperConsoleGrid() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SessionDiagnosticsPanel />
      <RuntimeDiagnosticsPanel />
      <RealtimeDiagnosticsPanel />
      <StoreDiagnosticsPanel />
      <ErrorLogPanel />
      <FeatureFlagsPanel />
    </div>
  );
}
