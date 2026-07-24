import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BellRing,
  GitBranch,
  MapPinned,
  ScrollText,
  Settings,
  ShieldAlert,
  UserCog,
  Users,
  Radio,
} from "lucide-react";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { MockBadge } from "@/components/MockBadge";
import { PageHeader, Panel } from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin · BELTrak" }] }),
  component: AdminDashboard,
});

const QUICK_LINKS = [
  {
    to: "/settings/users",
    label: "Users",
    description: "Manage airport staff accounts and access.",
    icon: Users,
    countKey: "users",
  },
  {
    to: "/settings/roles",
    label: "Roles",
    description: "Review canonical role capabilities.",
    icon: UserCog,
  },
  {
    to: "/settings/audit",
    label: "Audit",
    description: "Inspect administrative activity.",
    icon: ScrollText,
    countKey: "audit",
  },
  {
    to: "/settings/system",
    label: "System",
    description: "Configure application-wide settings.",
    icon: Settings,
  },
  {
    to: "/settings/threats",
    label: "Threats",
    description: "Maintain operational threat categories.",
    icon: ShieldAlert,
  },
  {
    to: "/settings/map",
    label: "Map",
    description: "Configure zones and reader placement.",
    icon: MapPinned,
    countKey: "readers",
  },
  {
    to: "/settings/escalations",
    label: "Escalations",
    description: "Manage notification and escalation rules.",
    icon: GitBranch,
  },
] as const;

function AdminDashboard() {
  const users = useAppStore((state) => state.users);
  const alarms = useAppStore((state) => state.alarms);
  const auditLog = useAppStore((state) => state.auditLog);
  const readers = useAppStore((state) => state.readers);

  const activeAlarms = alarms.filter((alarm) =>
    ["OPEN", "UNDER_INVESTIGATION", "ESCALATED"].includes(alarm.outcome),
  );
  const unresolvedAuditEntries = auditLog.filter(
    (entry) => !entry.action.toLowerCase().includes("resolved"),
  );
  const readersOnline = readers.filter((reader) => reader.status === "ONLINE");
  const counts = {
    users: users.length,
    audit: auditLog.length,
    readers: readers.length,
  };

  return (
    <RequireWorkspaceMode modes={["Admin"]}>
      <div className="p-6">
        <PageHeader
          title="Administration Overview"
          subtitle="System health, access management, and recent administrative activity."
          actions={<MockBadge />}
        />

        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Users", value: users.length, icon: Users, tone: "text-primary" },
            {
              label: "Active alarms",
              value: activeAlarms.length,
              icon: BellRing,
              tone: "text-danger",
            },
            {
              label: "Unresolved audit entries",
              value: unresolvedAuditEntries.length,
              icon: ScrollText,
              tone: "text-warning",
            },
            {
              label: "Readers online",
              value: readersOnline.length,
              icon: Radio,
              tone: "text-success",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border border-border bg-panel/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </span>
                  <Icon className={`size-4 ${item.tone}`} />
                </div>
                <div className={`mt-2 text-3xl font-semibold ${item.tone}`}>{item.value}</div>
              </div>
            );
          })}
        </div>

        <Panel title="Quick links" className="mb-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {QUICK_LINKS.map((item) => {
              const Icon = item.icon;
              const count = "countKey" in item ? counts[item.countKey] : null;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group rounded-lg border border-border bg-background/40 p-4 transition hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex size-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                      <Icon className="size-4 text-primary" />
                    </div>
                    {count !== null ? (
                      <span className="font-mono text-sm font-semibold">{count}</span>
                    ) : null}
                  </div>
                  <div className="mt-3 text-[13px] font-semibold group-hover:text-primary">
                    {item.label}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </Panel>

        <Panel title="Recent activity" action={<MockBadge />} className="overflow-hidden">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="border-b border-border bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 text-left font-medium">Actor</th>
                  <th className="px-4 py-2.5 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.slice(0, 10).map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">{entry.userName}</td>
                    <td className="px-4 py-2.5 font-mono">{entry.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </RequireWorkspaceMode>
  );
}
