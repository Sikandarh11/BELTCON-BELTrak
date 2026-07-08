import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { USERS } from "@/mocks/seed";
import { UserPlus, Search, MoreHorizontal } from "lucide-react";

export const Route = createFileRoute("/settings/users")({
  head: () => ({ meta: [{ title: "Manage Users · BELTrak" }] }),
  component: ManageUsers,
});

function ManageUsers() {
  return (
    <div className="p-6">
      <PageHeader
        title="Manage Users"
        subtitle="15 officers and administrators with access to BELTrak."
        actions={
          <div className="flex gap-2">
            <div className="relative">
              <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input placeholder="Search users…" className="bg-background border border-border rounded-md pl-8 pr-3 py-1.5 text-[12px] w-64" />
            </div>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"><UserPlus className="size-3.5" />Invite user</button>
          </div>
        }
      />

      <Panel className="!p-0">
        <table className="w-full text-[12.5px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/40">
            <tr>{["Name","Email","Role","Status","Last Login",""].map(h => <th key={h} className="text-left px-3 py-2.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {USERS.map((u) => {
              const init = u.name.split(" ").map(n => n[0]).slice(0,2).join("");
              return (
                <tr key={u.email} className="border-b border-border hover:bg-accent/30">
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
                  <td className="px-3 py-2.5"><button className="size-7 rounded hover:bg-accent inline-flex items-center justify-center"><MoreHorizontal className="size-4 text-muted-foreground"/></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
