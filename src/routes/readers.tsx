import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { useState } from "react";
import { Radio, X, Wifi, Cpu, Activity } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";

export const Route = createFileRoute("/readers")({
  head: () => ({ meta: [{ title: "RFID Readers · BELTrak" }] }),
  component: Readers,
});

function Readers() {
  const session = useSession();
  const [sel, setSel] = useState<string | null>("RDR-019");
  const readers = useAppStore((s) => s.readers);
  const reader = readers.find(r => r.id === sel);
  const allEvents = useAppStore((s) => s.events);

  const total = readers.length;
  const online = readers.filter((r) => r.status === "ONLINE").length;
  const degraded = readers.filter((r) => r.status === "DEGRADED").length;
  const offline = readers.filter((r) => r.status === "OFFLINE").length;

  const readerLastEvent = reader
    ? allEvents
        .filter((e) => e.readerId === reader.id)
        .sort((a, b) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime())[0]
    : null;

  const [configuring, setConfiguring] = useState(false);
  const [configIp, setConfigIp] = useState("");
  const [configZone, setConfigZone] = useState("");

  return (
    <RoleGate userRole={session.role} requiredRole="Control Center Operator" pageName="RFID Reader Management">
    <div className="p-6">
      <PageHeader title="RFID Reader Management" subtitle={`${total} readers across reclaim, customs, and back-of-house zones.`} />

      <div className="grid grid-cols-4 gap-3 mb-4 text-[12px]">
        {[
          { l: "Total readers", v: total, c: "text-foreground" },
          { l: "Online", v: online, c: "text-success" },
          { l: "Degraded", v: degraded, c: "text-warning" },
          { l: "Offline", v: offline, c: "text-danger" },
        ].map((s) => (
          <div key={s.l} className="rounded-lg border border-border bg-panel/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
            <div className={`text-2xl font-semibold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Panel className={`col-span-12 ${sel ? "lg:col-span-8" : "lg:col-span-12"} !p-0`}>
          <table className="w-full text-[12.5px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/40">
              <tr>{["Reader ID","Name","Type","Floor","IP Address","Read Rate","Status"].map(h => <th key={h} className="text-left px-3 py-2.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {readers.map((r) => (
                <tr key={r.id} onClick={() => setSel(r.id)} className={`border-b border-border cursor-pointer hover:bg-accent/30 ${sel === r.id ? "bg-accent/40" : ""}`}>
                  <td className="px-3 py-2.5 font-mono text-primary">{r.id}</td>
                  <td className="px-3 py-2.5">{r.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.model}</td>
                  <td className="px-3 py-2.5 font-mono">G</td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{r.ip}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className={`h-full ${r.readRate > 90 ? "bg-success" : r.readRate > 60 ? "bg-warning" : "bg-danger"}`} style={{ width: `${r.readRate}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground">{r.readRate}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><StatusPill status={r.status === "ONLINE" ? "Online" : r.status === "DEGRADED" ? "Degraded" : "Offline"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {reader && (
          <Panel title="Reader Detail" className="col-span-12 lg:col-span-4" action={<button onClick={() => setSel(null)}><X className="size-3.5 text-muted-foreground" /></button>}>
            <div className="flex items-center gap-3 pb-3 border-b border-border mb-3">
              <div className="size-12 rounded-md bg-info/15 border border-info/30 flex items-center justify-center">
                <Radio className="size-6 text-info" />
              </div>
              <div>
                <div className="font-mono font-semibold">{reader.id}</div>
                <div className="text-[12px] text-muted-foreground">{reader.name}</div>
                <div className="mt-1"><StatusPill status={reader.status === "ONLINE" ? "Online" : reader.status === "DEGRADED" ? "Degraded" : "Offline"} /></div>
              </div>
            </div>
            <dl className="space-y-2 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-muted-foreground flex items-center gap-1.5"><Cpu className="size-3.5" />Model</dt><dd className="font-mono">{reader.model}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground flex items-center gap-1.5"><Wifi className="size-3.5" />IP Address</dt><dd className="font-mono">{reader.ip}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Firmware</dt><dd className="font-mono">7.4.1.240</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Antennas</dt><dd className="font-mono">4 / 4 active</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground flex items-center gap-1.5"><Activity className="size-3.5" />Last Event</dt><dd className="font-mono">{readerLastEvent ? new Date(readerLastEvent.firstSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "No events"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Uptime</dt><dd className="font-mono">37d 4h 22m</dd></div>
            </dl>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Antennas</div>
              <div className="grid grid-cols-4 gap-1.5">
                {["A1","A2","A3","A4"].map((a, i) => (
                    <div key={a} className={`rounded-md border ${i === 2 && reader.status === "DEGRADED" ? "border-warning bg-warning/10" : "border-success/30 bg-success/5"} p-2 text-center`}>
                    <div className="text-[10px] font-mono">{a}</div>
                      <div className="text-[10px] text-muted-foreground">{i === 2 && reader.status === "DEGRADED" ? "-62 dBm" : "-41 dBm"}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  if (!reader) return;
                  useAppStore.getState().updateReader(reader.id, { status: "OFFLINE", readRate: 0 });
                  toast.info(`${reader.id} restarting...`);
                  setTimeout(() => {
                    useAppStore.getState().updateReader(reader.id, { status: "ONLINE", readRate: 99 });
                    toast.success(`${reader.id} back online`);
                  }, 2000);
                }}
                className="text-[12px] px-2.5 py-1.5 rounded-md border border-border hover:bg-accent"
              >
                Restart
              </button>
              <button
                onClick={() => {
                  if (!reader) return;
                  setConfigIp(reader.ip);
                  setConfigZone(reader.zone);
                  setConfiguring(true);
                }}
                className="text-[12px] px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground font-medium"
              >
                Configure
              </button>
            </div>
            {configuring && reader && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">IP Address</label>
                  <input
                    value={configIp}
                    onChange={(e) => setConfigIp(e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1.5 font-mono text-[12px]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Zone</label>
                  <input
                    value={configZone}
                    onChange={(e) => setConfigZone(e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1.5 font-mono text-[12px]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      useAppStore.getState().updateReader(reader.id, { ip: configIp, zone: configZone });
                      setConfiguring(false);
                      toast.success(`${reader.id} updated`);
                    }}
                    className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground font-medium"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setConfiguring(false)}
                    className="text-[12px] px-2.5 py-1.5 rounded-md border border-border hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
    </RoleGate>
  );
}
