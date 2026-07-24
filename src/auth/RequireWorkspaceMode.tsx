import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useWorkspaceMode } from "@/auth/SessionContext";
import { getWorkspaceLanding, type WorkspaceMode } from "@/auth/appRoles";

/**
 * NAVIGATION GUARD ONLY. This checks a client-selected workspace mode
 * stored in localStorage. It is NOT an authorization boundary. Never
 * use it to gate mutating actions, data reads, or admin/dev privileges.
 * For real authorization, use canonical role via <RoleGate>.
 */
export function RequireWorkspaceMode({
  modes,
  children,
}: {
  modes: readonly WorkspaceMode[];
  children: ReactNode;
}) {
  const { workspaceMode } = useWorkspaceMode();

  if (!modes.includes(workspaceMode)) {
    return <Navigate to={getWorkspaceLanding(workspaceMode)} replace />;
  }

  return <>{children}</>;
}
