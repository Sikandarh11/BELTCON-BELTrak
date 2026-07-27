import { z } from "zod";

export const CANONICAL_ROLES = [
  "Operations Officer",
  "Control Center Operator",
  "Customs Supervisor",
  "Airport Administrator",
  "System Administrator",
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

export const canonicalRoleSchema = z.enum(CANONICAL_ROLES);

const ROLE_RANK = new Map<CanonicalRole, number>(
  CANONICAL_ROLES.map((role, index) => [role, index]),
);

export class CanonicalRoleAccessError extends Error {
  readonly code = "CANONICAL_ROLE_REQUIRED";
  readonly requiredRole: CanonicalRole;

  constructor(requiredRole: CanonicalRole) {
    super(`Canonical ${requiredRole} role or higher is required`);
    this.name = "CanonicalRoleAccessError";
    this.requiredRole = requiredRole;
  }
}

export function isCanonicalRole(value: unknown): value is CanonicalRole {
  return typeof value === "string" && ROLE_RANK.has(value as CanonicalRole);
}

export function canonicalRoleRank(value: unknown): number | null {
  return isCanonicalRole(value) ? (ROLE_RANK.get(value) ?? null) : null;
}

export function compareCanonicalRoles(left: unknown, right: unknown): number | null {
  const leftRank = canonicalRoleRank(left);
  const rightRank = canonicalRoleRank(right);
  return leftRank === null || rightRank === null ? null : leftRank - rightRank;
}

export function roleIsAtLeast(role: unknown, requiredRole: unknown): boolean {
  const comparison = compareCanonicalRoles(role, requiredRole);
  return comparison !== null && comparison >= 0;
}

export function requireCanonicalRole(role: unknown, requiredRole: CanonicalRole): CanonicalRole {
  if (!roleIsAtLeast(role, requiredRole) || !isCanonicalRole(role)) {
    throw new CanonicalRoleAccessError(requiredRole);
  }
  return role;
}

export const PAGE_MINIMUM_CANONICAL_ROLE = [
  { prefix: "/dev", role: "System Administrator" },
  { prefix: "/settings/roles", role: "System Administrator" },
  { prefix: "/settings/escalations", role: "Customs Supervisor" },
  { prefix: "/settings", role: "Airport Administrator" },
  { prefix: "/admin", role: "Airport Administrator" },
  { prefix: "/audit", role: "Airport Administrator" },
  { prefix: "/supervisor", role: "Customs Supervisor" },
  { prefix: "/readers", role: "Control Center Operator" },
  { prefix: "/", role: "Operations Officer" },
] as const satisfies readonly { prefix: string; role: CanonicalRole }[];

export function minimumCanonicalRoleForPath(pathname: string): CanonicalRole {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return (
    PAGE_MINIMUM_CANONICAL_ROLE.find(
      ({ prefix }) =>
        prefix === "/" || normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
    )?.role ?? "Operations Officer"
  );
}

export function canAccessCanonicalPath(role: unknown, pathname: string): boolean {
  return roleIsAtLeast(role, minimumCanonicalRoleForPath(pathname));
}
