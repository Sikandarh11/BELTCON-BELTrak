import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

import {
  minimumCanonicalRoleForPath,
  roleIsAtLeast,
  type CanonicalRole,
} from "@/auth/canonicalRoles";
import { hasPermission, hasRoutePermission, permissionRuleForPath } from "@/auth/permissions";
import type { PermissionCode } from "@/services/admin/roles/roleSchemas";

interface RoleGateProps {
  userRole: unknown;
  requiredRole: CanonicalRole;
  children: ReactNode;
  pageName?: string;
}

export function RoleGate({ userRole, requiredRole, children, pageName }: RoleGateProps) {
  if (!roleIsAtLeast(userRole, requiredRole)) {
    const displayedRole = typeof userRole === "string" ? userRole : "Unknown";
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldAlert className="size-10 text-muted-foreground mb-4" />
        <div className="text-lg font-semibold">Access Denied</div>
        <div className="text-[13px] text-muted-foreground mt-1 max-w-sm">
          {pageName ? `The ${pageName} page requires` : "This page requires"}{" "}
          <span className="font-medium text-foreground">{requiredRole}</span> role or higher. Your
          current canonical role is{" "}
          <span className="font-medium text-foreground">{displayedRole}</span>.
        </div>
        <div className="mt-4 text-[12px] text-muted-foreground">
          Contact your Airport Administrator to request access.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function CanonicalPageGate({
  pathname,
  userRole,
  children,
}: {
  pathname: string;
  userRole: unknown;
  children: ReactNode;
}) {
  const requiredRole = minimumCanonicalRoleForPath(pathname);
  return (
    <RoleGate userRole={userRole} requiredRole={requiredRole} pageName={pathname}>
      {children}
    </RoleGate>
  );
}

export function PermissionGate({
  userPermissions,
  requiredPermission,
  children,
  pageName,
}: {
  userPermissions: readonly string[] | null | undefined;
  requiredPermission: PermissionCode;
  children: ReactNode;
  pageName?: string;
}) {
  if (!hasPermission(userPermissions, requiredPermission)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldAlert className="size-10 text-muted-foreground mb-4" />
        <div className="text-lg font-semibold">Access Denied</div>
        <div className="text-[13px] text-muted-foreground mt-1 max-w-sm">
          {pageName ? `The ${pageName} page requires` : "This page requires"}{" "}
          <span className="font-medium text-foreground">{requiredPermission}</span>.
        </div>
        <div className="mt-4 text-[12px] text-muted-foreground">
          Contact your System Administrator to request access.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function PermissionPageGate({
  pathname,
  userPermissions,
  children,
}: {
  pathname: string;
  userPermissions: readonly string[] | null | undefined;
  children: ReactNode;
}) {
  const rule = permissionRuleForPath(pathname);
  if (!hasRoutePermission(userPermissions, pathname)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldAlert className="size-10 text-muted-foreground mb-4" />
        <div className="text-lg font-semibold">Access Denied</div>
        <div className="text-[13px] text-muted-foreground mt-1 max-w-sm">
          This page requires {rule.anyOf.join(" or ")}.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
