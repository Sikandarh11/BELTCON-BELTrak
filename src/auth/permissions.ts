import type { PermissionCode } from "@/services/admin/roles/roleSchemas";

export type RoutePermissionRule = {
  prefix: string;
  anyOf: readonly PermissionCode[];
  allOf?: readonly PermissionCode[];
};

/**
 * Client route visibility map. It is intentionally mirrored by server checks:
 * this map improves navigation UX but never authorizes a request by itself.
 */
export const PAGE_PERMISSION_RULES = [
  { prefix: "/dev/simulator", anyOf: ["simulator.use"] },
  { prefix: "/dev", anyOf: ["developer.access"] },
  { prefix: "/settings/roles", anyOf: ["role.view"] },
  { prefix: "/settings/users", anyOf: ["user.view"] },
  { prefix: "/settings/audit", anyOf: ["audit.view"] },
  { prefix: "/settings", anyOf: ["settings.manage"] },
  { prefix: "/admin", anyOf: ["settings.manage"] },
  { prefix: "/audit", anyOf: ["audit.view"] },
  { prefix: "/supervisor", anyOf: ["alarm.escalate"] },
  { prefix: "/readers", anyOf: ["reader.view"] },
  { prefix: "/reports", anyOf: ["report.view"] },
  { prefix: "/tagging", anyOf: ["bag.tag"] },
  { prefix: "/recheck", anyOf: ["bag.recheck"] },
  { prefix: "/target", anyOf: ["bag.recheck"] },
  { prefix: "/ops", anyOf: ["bag.manage", "bag.read"] },
  { prefix: "/alarms", anyOf: ["alarm.read", "alarm.acknowledge"] },
  { prefix: "/", anyOf: ["dashboard.view"] },
] as const satisfies readonly RoutePermissionRule[];

export function permissionRuleForPath(pathname: string): RoutePermissionRule {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return (
    PAGE_PERMISSION_RULES.find(
      ({ prefix }) =>
        prefix === "/" || normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
    ) ?? { prefix: "/", anyOf: ["dashboard.view"] }
  );
}

export function permissionForPath(pathname: string): PermissionCode {
  return permissionRuleForPath(pathname).anyOf[0] ?? "dashboard.view";
}

export function hasPermission(
  permissions: readonly string[] | null | undefined,
  permission: PermissionCode,
) {
  return Boolean(permissions?.includes(permission));
}

export function hasRoutePermission(
  permissions: readonly string[] | null | undefined,
  pathname: string,
) {
  const rule = permissionRuleForPath(pathname);
  const hasAny = rule.anyOf.some((permission) => hasPermission(permissions, permission));
  const hasAll = (rule.allOf ?? []).every((permission) => hasPermission(permissions, permission));
  return hasAny && hasAll;
}
