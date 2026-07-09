import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

interface RoleGateProps {
  userRole: string;
  requiredRole: string;
  children: ReactNode;
  pageName?: string;
}

export function RoleGate({ userRole, requiredRole, children, pageName }: RoleGateProps) {
  const order = [
    "Operations Officer",
    "Control Center Operator",
    "Customs Supervisor",
    "Airport Administrator",
    "System Administrator",
  ];
  const userRank = order.indexOf(userRole);
  const requiredRank = order.indexOf(requiredRole);

  if (userRank === -1 || requiredRank === -1 || userRank < requiredRank) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldAlert className="size-10 text-muted-foreground mb-4" />
        <div className="text-lg font-semibold">Access Denied</div>
        <div className="text-[13px] text-muted-foreground mt-1 max-w-sm">
          {pageName ? `The ${pageName} page requires` : "This page requires"}{" "}
          <span className="font-medium text-foreground">{requiredRole}</span>{" "}
          role or higher. Your current role is{" "}
          <span className="font-medium text-foreground">{userRole}</span>.
        </div>
        <div className="mt-4 text-[12px] text-muted-foreground">
          Contact your Airport Administrator to request access.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}