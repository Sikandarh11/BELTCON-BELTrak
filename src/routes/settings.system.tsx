import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { Save } from "lucide-react";

export const Route = createFileRoute("/settings/system")({
  head: () => ({ meta: [{ title: "System Settings · BELTrak" }] }),
  component: SystemSettings,
});

const INTEGRATIONS = [
  { n: "BHS · Baggage Handling System", v: "v4.2.1", s: "CONNECTED" },
  { n: "X-Ray System (Smiths Detection)", v: "HI-SCAN 10080", s: "CONNECTED" },
  { n: "Passenger Information System (PIS)", v: "Amadeus Altéa", s: "CONNECTED" },
  { n: "RFID Infrastructure (Impinj / Zebra)", v: "ItemSense 2024.3", s: "CONNECTED" },
  { n: "CCTV Bridge (Milestone XProtect)", v: "2024 R2", s: "CONNECTED" },
  { n: "Customs Declaration API", v: "v2", s: "CONNECTED" },
];

function SystemSettings() {
  return (
    <div className="p-6 max-w-6xl">
      <PageHeader title="System Settings" subtitle="Airport profile, time, and external integrations." />

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Airport Profile" className="col-span-12 lg:col-span-7">
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            <Field label="Airport Name" v="King Abdulaziz International Airport" />
            <Field label="Airport Code" v="LTI" mono />
            <Field label="Timezone" v="Asia/Riyadh (UTC+03)" />
            <Field label="Operating Hours" v="24 / 7" />
            <Field label="Terminal" v="Terminal 1" />
            <Field label="Customs Authority" v="Saudi Zakat, Tax and Customs Authority" />
            <Field label="Default Language" v="English (en-SA)" />
            <Field label="Date Format" v="DD/MM/YYYY HH:mm" mono />
          </div>
          <div className="mt-4 pt-4 border-t border-border flex justify-end">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"><Save className="size-3.5" />Save changes</button>
          </div>
        </Panel>

        <Panel title="Integrations" className="col-span-12 lg:col-span-5">
          <ul className="space-y-2">
            {INTEGRATIONS.map((i) => (
              <li key={i.n} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <div className="text-[13px]">{i.n}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{i.v}</div>
                </div>
                <StatusPill status={i.s} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Security & Audit" className="col-span-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-[13px]">
            <Toggle label="Require MFA for all officers" on />
            <Toggle label="Session timeout · 30 min" on />
            <Toggle label="Audit log retention · 365 days" on />
            <Toggle label="Sign actions with operator key" on={false} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Field({ label, v, mono }: { label: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input defaultValue={v} className={`w-full bg-background border border-border rounded px-2.5 py-1.5 ${mono ? "font-mono" : ""}`} />
    </div>
  );
}
function Toggle({ label, on }: { label: string; on: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-background/40">
      <span>{label}</span>
      <span className={`relative inline-flex h-5 w-9 rounded-full transition ${on ? "bg-primary" : "bg-secondary"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-background transition-all ${on ? "left-4" : "left-0.5"}`} />
      </span>
    </label>
  );
}
