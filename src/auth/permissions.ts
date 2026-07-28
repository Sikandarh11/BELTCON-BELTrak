import type { PermissionCode } from "@/services/admin/roles/roleSchemas";

export const PAGE_PERMISSION_RULES = [
  { prefix: "/dev", permission: "developer.access" },
  { prefix: "/settings/roles", permission: "role.view" },
  { prefix: "/settings/users", permission: "user.view" },
  { prefix: "/settings/audit", permission: "audit.view" },
  { prefix: "/settings", permission: "settings.manage" },
  { prefix: "/admin", permission: "settings.manage" },
  { prefix: "/audit", permission: "audit.view" },
  { prefix: "/supervisor", permission: "alarm.escalate" },
  { prefix: "/readers", permission: "reader.view" },
  { prefix: "/reports", permission: "report.view" },
  { prefix: "/tagging", permission: "bag.tag" },
  { prefix: "/recheck", permission: "bag.recheck" },
  { prefix: "/target", permission: "bag.recheck" },
  { prefix: "/ops", permission: "bag.manage" },
  { prefix: "/alarms", permission: "alarm.acknowledge" },
  { prefix: "/", permission: "dashboard.view" },
] as const satisfies readonly { prefix: string; permission: PermissionCode }[];

export function permissionForPath(pathname: string): PermissionCode {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return (
    PAGE_PERMISSION_RULES.find(
      ({ prefix }) =>
        prefix === "/" || normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
    )?.permission ?? "dashboard.view"
  );
}

export function hasPermission(
  permissions: readonly string[] | null | undefined,
  permission: PermissionCode,
) {
  return Boolean(permissions?.includes(permission));
}
