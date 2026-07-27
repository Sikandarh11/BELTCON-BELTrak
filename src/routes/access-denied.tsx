import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

import { minimumCanonicalRoleForPath } from "@/auth/canonicalRoles";
import { useSession } from "@/auth/SessionContext";

export const Route = createFileRoute("/access-denied")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: typeof search.from === "string" && search.from.startsWith("/") ? search.from : "/",
  }),
  head: () => ({ meta: [{ title: "Access Denied · BELTrak" }] }),
  component: AccessDeniedPage,
});

function AccessDeniedPage() {
  const session = useSession();
  const { from } = Route.useSearch();
  const requiredRole = minimumCanonicalRoleForPath(from);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-xl border border-border bg-panel/70 p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
          <ShieldAlert className="size-6 text-danger" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Access Denied</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-mono text-foreground">{from}</span> requires the canonical{" "}
          <span className="font-medium text-foreground">{requiredRole}</span> role or higher. Your
          current role is <span className="font-medium text-foreground">{session.role}</span>.
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Workspace mode cannot grant access. Contact an Airport Administrator if your assignment is
          incorrect.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
