import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { Plus, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";

export const Route = createFileRoute("/settings/threats")({
  head: () => ({ meta: [{ title: "Threat Types · BELTrak" }] }),
  component: Threats,
});

const THREATS = [
  { id: "T-001", name: "Suspect Bag", desc: "Bag flagged by customs operator at tagging station for follow-up tracking and inspection.", color: "var(--color-danger)" },
];

function Threats() {
  const session = useSession();
  const [threats, setThreats] = useState(THREATS);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState("");

  return (
    <RoleGate userRole={session.role} requiredRole="Airport Administrator" pageName="Threat Types">
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Threat Types"
        subtitle="BELTrak uses a single, unambiguous threat model — there are no graded threat levels."
        actions={<button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"><Plus className="size-3.5" />Add threat type</button>}
      />

      <Panel className="!p-0">
        <table className="w-full text-[13px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/40">
            <tr>{["Threat ID","Name","Description","Color","Actions"].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {threats.map((t, i) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-primary">{t.id}</td>
                <td className="px-4 py-3"><div className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4 text-danger" />{t.name}</div></td>
                <td className="px-4 py-3 text-muted-foreground max-w-md">
                  {editIdx === i ? (
                    <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-[13px]" />
                  ) : (
                    t.desc
                  )}
                </td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="size-4 rounded" style={{ background: t.color }} /><span className="font-mono text-[11px] text-muted-foreground">{t.color}</span></div></td>
                <td className="px-4 py-3">
                  {editIdx === i ? (
                    <div className="flex gap-1">
                      <button onClick={() => {
                        const updated = [...threats];
                        updated[i] = { ...updated[i], desc: editDesc };
                        setThreats(updated);
                        setEditIdx(null);
                        toast.success("Threat type updated");
                      }} className="text-[12px] text-success hover:underline">Save</button>
                      <button onClick={() => setEditIdx(null)} className="text-[12px] text-muted-foreground hover:underline">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditIdx(i); setEditDesc(t.desc); }}
                      className="text-[12px] text-primary hover:underline">Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="mt-4 rounded-lg border border-info/30 bg-info/5 p-4 text-[12.5px] text-info">
        <strong>Design note:</strong> BELTrak deliberately avoids 5-tier threat severity. Every flagged bag is treated as a single, equal "Suspect Bag" — officers determine handling at the recheck station.
      </div>
    </div>
    </RoleGate>
  );
}
