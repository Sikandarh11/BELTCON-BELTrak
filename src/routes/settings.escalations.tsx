import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { ESCALATIONS } from "@/lib/data";
import { Plus, Mail, MessageSquare, Bell } from "lucide-react";

export const Route = createFileRoute("/settings/escalations")({
  head: () => ({ meta: [{ title: "Escalations · BELTrak" }] }),
  component: Escalations,
});

function Escalations() {
  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Escalation Rules"
        subtitle="Define who is notified when specific triggers fire on the floor."
        actions={<button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"><Plus className="size-3.5" />New rule</button>}
      />

      <Panel className="!p-0">
        <table className="w-full text-[13px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/40">
            <tr>{["Trigger","Assigned Role","Notification Method","SLA","Status","Actions"].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {ESCALATIONS.map((e, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/30">
                <td className="px-4 py-3 font-medium">{e.trigger}</td>
                <td className="px-4 py-3">{e.role}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {e.method.includes("Email") && <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-info/30 bg-info/10 text-info"><Mail className="size-3"/>Email</span>}
                    {e.method.includes("SMS") && <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning"><MessageSquare className="size-3"/>SMS</span>}
                    {e.method.includes("Push") && <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-success/30 bg-success/10 text-success"><Bell className="size-3"/>Push</span>}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono">{e.sla}</td>
                <td className="px-4 py-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-success">Enabled</span></td>
                <td className="px-4 py-3"><button className="text-[12px] text-primary hover:underline">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
