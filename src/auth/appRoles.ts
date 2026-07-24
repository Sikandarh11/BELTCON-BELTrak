export const APP_ROLES = ["Admin", "Developer", "Operator", "Supervisor", "Auditor"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const LAST_ROLE_STORAGE_KEY = "sbts.lastRole";
export const DEBUG_STORAGE_KEY = "sbts.debug";
export const FOCUS_ROLE_STORAGE_KEY = "sbts.focusRole";

export const ROLE_DETAILS: Record<
  AppRole,
  { helperText: string; shortLabel: string; dashboardPath: RoleDashboardPath }
> = {
  Admin: {
    helperText: "Full system access",
    shortLabel: "ADMIN",
    dashboardPath: "/admin/dashboard",
  },
  Developer: {
    helperText: "Debug + config access",
    shortLabel: "DEV",
    dashboardPath: "/dev/console",
  },
  Operator: {
    helperText: "Day-to-day tag/scan operations",
    shortLabel: "OPERATOR",
    dashboardPath: "/ops/scan",
  },
  Supervisor: {
    helperText: "Shift oversight + overrides",
    shortLabel: "SUPERVISOR",
    dashboardPath: "/supervisor/overview",
  },
  Auditor: {
    helperText: "Read-only + logs",
    shortLabel: "AUDITOR",
    dashboardPath: "/audit/logs",
  },
};

export type RoleDashboardPath =
  | "/admin/dashboard"
  | "/dev/console"
  | "/ops/scan"
  | "/supervisor/overview"
  | "/audit/logs";

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.includes(value as AppRole);
}

export function getLastRole(fallback: AppRole): AppRole {
  if (typeof window === "undefined") {
    return fallback;
  }

  const storedRole = window.localStorage.getItem(LAST_ROLE_STORAGE_KEY);
  return isAppRole(storedRole) ? storedRole : fallback;
}

export function persistLastRole(role: AppRole) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LAST_ROLE_STORAGE_KEY, role);
  }
}

export function getRoleDashboard(role: AppRole): RoleDashboardPath {
  return ROLE_DETAILS[role].dashboardPath;
}
