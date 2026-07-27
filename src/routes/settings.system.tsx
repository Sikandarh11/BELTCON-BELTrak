import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";
import { getHbssHealth, type HbssHealth } from "@/services/xray/xrayClient";

export const Route = createFileRoute("/settings/system")({
  head: () => ({ meta: [{ title: "System Settings · BELTrak" }] }),
  component: SystemSettings,
});

const INTEGRATIONS = [
  { n: "BHS · Baggage Handling System", v: "Simulated", s: "SIMULATED" },
  { n: "RFID Infrastructure (ThingMagic IZAR)", v: "Simulated", s: "SIMULATED" },
  { n: "CCTV Bridge", v: "Not connected", s: "PENDING" },
  { n: "Customs Declaration API", v: "Not connected", s: "PENDING" },
];

function SystemSettings() {
  const session = useSession();
  const [hbssHealth, setHbssHealth] = useState<HbssHealth | null>(null);
  const [hbssHealthLoading, setHbssHealthLoading] = useState(true);

  const loadHbssHealth = useCallback(() => {
    setHbssHealthLoading(true);
    void getHbssHealth()
      .then(setHbssHealth)
      .catch(() =>
        setHbssHealth({
          adapter: "Unknown",
          healthy: false,
          status: "UNAVAILABLE",
          lastChecked: new Date().toISOString(),
          message: "HBSS health information is unavailable",
        }),
      )
      .finally(() => setHbssHealthLoading(false));
  }, []);

  useEffect(() => {
    loadHbssHealth();
  }, [loadHbssHealth]);

  return (
    <RoleGate
      userRole={session.role}
      requiredRole="Airport Administrator"
      pageName="System Settings"
    >
      <div className="p-6 max-w-6xl">
        <PageHeader
          title="System Settings"
          subtitle="Site profile, time, and external integrations. Configuration controls are simulated and not persisted."
        />

        <div className="grid grid-cols-12 gap-4">
          <Panel title="Site Profile" className="col-span-12 lg:col-span-7">
            <div className="grid grid-cols-2 gap-4 text-[13px]">
              <Field label="Site Name" v="BELTrak Operations Center" />
              <Field label="Site Code" v="BLC" mono />
              <Field label="Timezone" v="UTC+03" />
              <Field label="Operating Hours" v="24 / 7" />
              <Field label="Terminal" v="Terminal 1" />
              <Field label="Compliance Owner" v="Operations Control" />
              <Field label="Default Language" v="English (en-SA)" />
              <Field label="Date Format" v="DD/MM/YYYY HH:mm" mono />
            </div>
            <div className="mt-4 pt-4 border-t border-border flex justify-end">
              <button
                onClick={() =>
                  toast.info("Simulation only - site profile changes are not persisted")
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"
              >
                <Save className="size-3.5" />
                Simulate save
              </button>
            </div>
          </Panel>

          <Panel title="Integrations" className="col-span-12 lg:col-span-5">
            <ul className="space-y-2">
              <li className="border-b border-border py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px]">HBSS / X-Ray Adapter</div>
                    <div className="mt-0.5 text-[11px] font-mono text-muted-foreground">
                      Adapter: {hbssHealth?.adapter ?? "Checking"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {hbssHealth?.message ?? "Checking adapter health..."}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Last checked:{" "}
                      {hbssHealth
                        ? new Date(hbssHealth.lastChecked).toLocaleString()
                        : "In progress"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={hbssHealth?.status ?? "PENDING"} />
                    <button
                      type="button"
                      onClick={loadHbssHealth}
                      disabled={hbssHealthLoading}
                      className="rounded border border-border p-1.5 hover:bg-accent disabled:opacity-50"
                      aria-label="Refresh HBSS adapter health"
                    >
                      <RefreshCw
                        className={`size-3.5 ${hbssHealthLoading ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              </li>
              {INTEGRATIONS.map((i) => (
                <li
                  key={i.n}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <div>
                    <div className="text-[13px]">{i.n}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{i.v}</div>
                  </div>
                  <StatusPill status={i.s} />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Security & Audit · Simulated, not persisted" className="col-span-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-[13px]">
              <Toggle label="Require MFA for all officers" on />
              <Toggle label="Session timeout · 30 min" on />
              <Toggle label="Audit log retention · 365 days" on />
              <Toggle label="Sign actions with operator key" on={false} />
            </div>
          </Panel>
        </div>
      </div>
    </RoleGate>
  );
}

function Field({ label, v, mono }: { label: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input
        defaultValue={v}
        className={`w-full bg-background border border-border rounded px-2.5 py-1.5 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
function Toggle({ label, on }: { label: string; on: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-background/40">
      <span>{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 rounded-full transition ${on ? "bg-primary" : "bg-secondary"}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-background transition-all ${on ? "left-4" : "left-0.5"}`}
        />
      </span>
    </label>
  );
}
