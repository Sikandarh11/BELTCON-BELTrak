import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings, UserCog, Users } from "lucide-react";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader, Panel } from "@/components/AppLayout";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Administration · BELTCON SBTS" }] }),
  component: AdminDashboard,
});

const links = [
  { to: "/settings/users", label: "Manage Users", icon: Users },
  { to: "/settings/roles", label: "Manage Roles", icon: UserCog },
  { to: "/settings/system", label: "System Settings", icon: Settings },
] as const;

function AdminDashboard() {
  return (
    <RequireWorkspaceMode modes={["Admin"]}>
      <div className="p-6">
        <PageHeader
          title="Administration Overview"
          subtitle="Authoritative identity, role, and permission administration."
        />
        <Panel title="Administration">
          <p className="mb-4 text-sm text-muted-foreground">
            Operational counts and recent activity are not enabled in this release.
          </p>
          <div className="flex flex-wrap gap-2">
            {links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                <Icon className="size-4 text-primary" />
                {label}
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </RequireWorkspaceMode>
  );
}
