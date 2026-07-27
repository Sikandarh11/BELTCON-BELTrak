import { createFileRoute } from "@tanstack/react-router";
import { Panel, PageHeader } from "@/components/AppLayout";
import { ROLES, PERMISSIONS, ROLE_MATRIX } from "@/mocks/seed";
import { Check, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/auth/SessionContext";
import { RoleGate } from "@/components/RoleGate";

export const Route = createFileRoute("/settings/roles")({
  head: () => ({ meta: [{ title: "Manage Roles · BELTrak" }] }),
  component: ManageRoles,
});

function ManageRoles() {
  const session = useSession();
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>(() =>
    JSON.parse(JSON.stringify(ROLE_MATRIX)),
  );

  function togglePerm(role: string, perm: string) {
    setMatrix((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [perm]: !prev[role][perm],
      },
    }));
  }

  function handleSave() {
    toast.success("Role permissions saved");
  }

  return (
    <RoleGate userRole={session.role} requiredRole="System Administrator" pageName="Manage Roles">
      <div className="p-6">
        <PageHeader
          title="Manage Roles"
          subtitle="Permission matrix for all operational roles in BELTrak."
          actions={
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium">
              <Plus className="size-3.5" />
              New role
            </button>
          }
        />
        <Panel className="!p-0 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-background/40">
                <th className="text-left px-4 py-3 font-medium text-[10px] uppercase tracking-wider text-muted-foreground">
                  Permission
                </th>
                {ROLES.map((r) => (
                  <th key={r} className="text-center px-3 py-3 font-medium text-[11px]">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p} className="border-b border-border last:border-0 hover:bg-accent/20">
                  <td className="px-4 py-2.5">{p}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => togglePerm(r, p)}
                        className="hover:bg-accent rounded p-0.5"
                      >
                        {matrix[r][p] ? (
                          <Check className="size-4 text-success inline-block" />
                        ) : (
                          <Minus className="size-4 text-muted-foreground/50 inline-block" />
                        )}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"
          >
            Save permissions
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-lg border border-border bg-panel/60 p-3">
              <div className="text-[13px] font-medium">{r}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {Object.values(matrix[r]).filter(Boolean).length} / {PERMISSIONS.length} permissions
              </div>
            </div>
          ))}
        </div>
      </div>
    </RoleGate>
  );
}
