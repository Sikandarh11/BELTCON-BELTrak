import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useAuthSession } from "@/auth/SessionContext";
import { getRoleDashboard, type AppRole } from "@/auth/appRoles";

export function RequireRole({
  roles,
  children,
}: {
  roles: readonly AppRole[];
  children: ReactNode;
}) {
  const { role } = useAuthSession();

  if (!roles.includes(role)) {
    return <Navigate to={getRoleDashboard(role)} replace />;
  }

  return <>{children}</>;
}
