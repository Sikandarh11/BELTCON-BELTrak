import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { ROLES } from "@/mocks/seed";
import { useState } from "react";
import { UserPlus, Search, MoreHorizontal, Trash2, Edit2, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";

export const Route = createFileRoute("/settings/users")({
  head: () => ({ meta: [{ title: "Manage Users · BELTrak" }] }),
  component: ManageUsers,
});

function ManageUsers() {
  const session = useSession();
  const users = useAppStore((s) => s.users);
  const { addUser, updateUser, deleteUser } = useAppStore.getState();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: ROLES[0] });

  const filtered = search
    ? users.filter((u) =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.role.toLowerCase().includes(search.toLowerCase())
      )
    : users;

  function handleAdd() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and email required");
      return;
    }
    addUser({
      id: `user-${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      status: "Active",
      last: "Never",
    });
    toast.success(`User ${form.name} added`);
    setForm({ name: "", email: "", role: ROLES[0] });
    setShowAdd(false);
  }

  function handleEdit(id: string) {
    const user = users.find((u) => u.id === id);
    if (!user) return;
    setForm({ name: user.name, email: user.email, role: user.role });
    setEditId(id);
    setShowAdd(true);
  }

  function handleSaveEdit() {
    if (!editId) return;
    updateUser(editId, { name: form.name, email: form.email, role: form.role });
    toast.success("User updated");
    setEditId(null);
    setShowAdd(false);
    setForm({ name: "", email: "", role: ROLES[0] });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete user ${name}?`)) return;
    deleteUser(id);
    toast.success(`${name} deleted`);
  }

  return (
    <RoleGate userRole={session.role} requiredRole="Airport Administrator" pageName="Manage Users">
    <div className="p-6">
      <PageHeader
        title="Manage Users"
        subtitle={`${users.length} officers and administrators with access to BELTrak.`}
        actions={
          <div className="flex gap-2">
            <div className="relative">
              <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                placeholder="Search users…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-background border border-border rounded-md pl-8 pr-3 py-1.5 text-[12px] w-64"
              />
            </div>
            <button
              onClick={() => { setEditId(null); setForm({ name: "", email: "", role: ROLES[0] }); setShowAdd(!showAdd); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"
            >
              <UserPlus className="size-3.5" />{showAdd ? "Cancel" : "Invite user"}
            </button>
          </div>
        }
      />

      {/* Add/Edit form */}
      {showAdd && (
        <Panel title={editId ? "Edit User" : "Add New User"} className="mb-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground">Full Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-[13px]" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Email</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-[13px] font-mono" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-[13px]">
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={editId ? handleSaveEdit : handleAdd}
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium">
              {editId ? "Save Changes" : "Add User"}
            </button>
          </div>
        </Panel>
      )}

      <Panel className="!p-0">
        <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border">
          Showing {filtered.length} of {users.length} users
        </div>
        <table className="w-full text-[12.5px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/40">
            <tr>{["Name","Email","Role","Status","Last Login","Actions"].map(h =>
              <th key={h} className="text-left px-3 py-2.5 font-medium">{h}</th>
            )}</tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const init = u.name.split(" ").map(n => n[0]).slice(0,2).join("");
              return (
                <tr key={u.id} className="border-b border-border hover:bg-accent/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded-full bg-gradient-to-br from-primary/70 to-info/70 flex items-center justify-center text-[10px] font-semibold text-primary-foreground">{init}</div>
                      <span className="font-medium">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{u.email}</td>
                  <td className="px-3 py-2.5">{u.role}</td>
                  <td className="px-3 py-2.5"><StatusPill status={u.status} /></td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{u.last}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(u.id)} title="Edit"
                        className="size-7 rounded hover:bg-accent inline-flex items-center justify-center">
                        <Edit2 className="size-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => handleDelete(u.id, u.name)} title="Delete"
                        className="size-7 rounded hover:bg-danger/10 inline-flex items-center justify-center">
                        <Trash2 className="size-3.5 text-danger" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
    </RoleGate>
  );
}