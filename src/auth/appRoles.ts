export const WORKSPACE_MODE_VALUES = [
  "Admin",
  "Developer",
  "Operator",
  "Supervisor",
  "Auditor",
] as const;

export type WorkspaceMode = (typeof WORKSPACE_MODE_VALUES)[number];

export const LAST_MODE_KEY = "sbts.lastRole";
export const DEBUG_KEY = "sbts.debug";
export const FOCUS_MODE_KEY = "sbts.focusRole";

export const WORKSPACE_MODES: Record<
  WorkspaceMode,
  {
    helperText: string;
    shortLabel: string;
    landingPath: WorkspaceLandingPath;
  }
> = {
  Admin: {
    helperText: "Full system access",
    shortLabel: "ADMIN",
    landingPath: "/admin/dashboard",
  },
  Developer: {
    helperText: "Debug + config access",
    shortLabel: "DEV",
    landingPath: "/dev/console",
  },
  Operator: {
    helperText: "Day-to-day tag/scan operations",
    shortLabel: "OPERATOR",
    landingPath: "/ops/scan",
  },
  Supervisor: {
    helperText: "Shift oversight + overrides",
    shortLabel: "SUPERVISOR",
    landingPath: "/supervisor/overview",
  },
  Auditor: {
    helperText: "Read-only + logs",
    shortLabel: "AUDITOR",
    landingPath: "/audit/logs",
  },
};

export type WorkspaceLandingPath =
  | "/admin/dashboard"
  | "/dev/console"
  | "/ops/scan"
  | "/supervisor/overview"
  | "/audit/logs";

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === "string" && WORKSPACE_MODE_VALUES.includes(value as WorkspaceMode);
}

export function getLastMode(fallback: WorkspaceMode): WorkspaceMode {
  if (typeof window === "undefined") {
    return fallback;
  }

  const storedMode = window.localStorage.getItem(LAST_MODE_KEY);
  return isWorkspaceMode(storedMode) ? storedMode : fallback;
}

export function setLastMode(workspaceMode: WorkspaceMode) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LAST_MODE_KEY, workspaceMode);
  }
}

export function getWorkspaceLanding(workspaceMode: WorkspaceMode): WorkspaceLandingPath {
  return WORKSPACE_MODES[workspaceMode].landingPath;
}
