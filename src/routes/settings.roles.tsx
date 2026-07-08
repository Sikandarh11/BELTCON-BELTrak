import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { ROLES, PERMISSIONS, ROLE_MATRIX } from "@/mocks/seed";
import { Check, Minus, Plus } from "lucide-react";

export const Route = createFileRoute("/settings/roles")({
  head: () => ({ meta: [{ title: "Manage Roles · BELTrak" }] }),
  component: ManageRoles,
});

function ManageRoles() {
  return (
    <div className="p-6">
      <PageHeader
        title="Manage Roles"
        subtitle="Permission matrix for all operational roles in BELTrak."
        actions={<button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"><Plus className="size-3.5" />New role</button>}
      />
      <Panel className="!p-0 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-background/40">
              <th className="text-left px-4 py-3 font-medium text-[10px] uppercase tracking-wider text-muted-foreground">Permission</th>
              {ROLES.map(r => (
                <th key={r} className="text-center px-3 py-3 font-medium text-[11px]">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p} className="border-b border-border last:border-0 hover:bg-accent/20">
                <td className="px-4 py-2.5">{p}</td>
                {ROLES.map(r => (
                  <td key={r} className="px-3 py-2.5 text-center">
                    {ROLE_MATRIX[r][p] ? (
                      <Check className="size-4 text-success inline-block" />
                    ) : (
                      <Minus className="size-4 text-muted-foreground/50 inline-block" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        {ROLES.map(r => (
          <div key={r} className="rounded-lg border border-border bg-panel/60 p-3">
            <div className="text-[13px] font-medium">{r}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {Object.values(ROLE_MATRIX[r]).filter(Boolean).length} / {PERMISSIONS.length} permissions
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
