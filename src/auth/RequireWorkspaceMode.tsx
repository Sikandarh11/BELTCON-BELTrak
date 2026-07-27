import type { ReactNode } from "react";

import type { WorkspaceMode } from "@/auth/appRoles";

/**
 * Compatibility wrapper for workspace-specific layout composition.
 * Workspace mode never grants or denies access. Canonical page access is
 * enforced by CanonicalPageGate and protected server endpoints.
 */
export function RequireWorkspaceMode({
  modes,
  children,
}: {
  modes: readonly WorkspaceMode[];
  children: ReactNode;
}) {
  void modes;
  return <>{children}</>;
}
