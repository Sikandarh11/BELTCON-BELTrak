import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { ROLES } from "@/mocks/seed";
import { useState } from "react";
import { Plus, Mail, MessageSquare, Bell, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";

export const Route = createFileRoute("/settings/escalations")({
  head: () => ({ meta: [{ title: "Escalations · BELTrak" }] }),
  component: Escalations,
});

const METHOD_OPTIONS = ["Email", "SMS", "Push", "Email + SMS", "SMS + Push", "Email + Push", "Email + SMS + Push"];
const TRIGGER_OPTIONS = [
  "Suspect Bag Detected",
  "Suspect Bag at Exit Gate",
  "Movement Alert (Washroom)",
  "Movement Alert (Restricted Zone)",
  "Reader Offline > 5 min",
  "Re-entry After Clearance",
  "Escape Alert",
];

function Escalations() {
  const session = useSession();
  const rules = useAppStore((s) => s.escalationRules);
  const { addEscalationRule, updateEscalationRule, deleteEscalationRule } = useAppStore.getState();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ trigger: TRIGGER_OPTIONS[0], role: ROLES[0], method: METHOD_OPTIONS[0], sla: "2 min" });

  function handleSave() {
    if (editId) {
      updateEscalationRule(editId, form);
      toast.success("Rule updated");
    } else {
      addEscalationRule({ id: `esc-${Date.now()}`, ...form, enabled: true });
      toast.success("Rule added");
    }
    setShowForm(false);
    setEditId(null);
    setForm({ trigger: TRIGGER_OPTIONS[0], role: ROLES[0], method: METHOD_OPTIONS[0], sla: "2 min" });
  }

  function handleEdit(id: string) {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;
    setForm({ trigger: rule.trigger, role: rule.role, method: rule.method, sla: rule.sla });
    setEditId(id);
    setShowForm(true);
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this rule?")) return;
    deleteEscalationRule(id);
    toast.success("Rule deleted");
  }

  function handleToggle(id: string, enabled: boolean) {
    updateEscalationRule(id, { enabled: !enabled });
    toast.info(enabled ? "Rule disabled" : "Rule enabled");
  }

  return (
    <RoleGate userRole={session.role} requiredRole="Customs Supervisor" pageName="Escalation Rules">
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Escalation Rules"
        subtitle={`${rules.length} rules · ${rules.filter((r) => r.enabled).length} active`}
        actions={
          <button onClick={() => { setEditId(null); setForm({ trigger: TRIGGER_OPTIONS[0], role: ROLES[0], method: METHOD_OPTIONS[0], sla: "2 min" }); setShowForm(!showForm); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium">
            <Plus className="size-3.5" />{showForm ? "Cancel" : "New rule"}
          </button>
        }
      />

      {showForm && (
        <Panel title={editId ? "Edit Rule" : "New Escalation Rule"} className="mb-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground">Trigger</label>
              <select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-[13px]">
                {TRIGGER_OPTIONS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Assigned Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-[13px]">
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Notification Method</label>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-[13px]">
                {METHOD_OPTIONS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">SLA</label>
              <input value={form.sla} onChange={(e) => setForm({ ...form, sla: e.target.value })}
                placeholder="e.g. 2 min"
                className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-[13px] font-mono" />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={handleSave}
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium">
              {editId ? "Save Changes" : "Add Rule"}
            </button>
          </div>
        </Panel>
      )}

      <Panel className="!p-0">
        <table className="w-full text-[13px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/40">
            <tr>{["Trigger","Assigned Role","Notification","SLA","Status","Actions"].map(h =>
              <th key={h} className="text-left px-4 py-2.5 font-medium">{h}</th>
            )}</tr>
          </thead>
          <tbody>
            {rules.map((e) => (
              <tr key={e.id} className={`border-b border-border last:border-0 hover:bg-accent/30 ${!e.enabled ? "opacity-50" : ""}`}>
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
                <td className="px-4 py-3">
                  <button onClick={() => handleToggle(e.id, e.enabled)}
                    className={`text-[10px] font-semibold uppercase tracking-wider ${e.enabled ? "text-success" : "text-muted-foreground"}`}>
                    {e.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => handleEdit(e.id)} className="size-7 rounded hover:bg-accent inline-flex items-center justify-center">
                      <Edit2 className="size-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(e.id)} className="size-7 rounded hover:bg-danger/10 inline-flex items-center justify-center">
                      <Trash2 className="size-3.5 text-danger" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
    </RoleGate>
  );
}