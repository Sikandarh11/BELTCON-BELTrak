import { LogOut } from "lucide-react";

import { useAuthSession } from "@/auth/SessionContext";
import type { WorkspaceMode } from "@/auth/appRoles";

export function RolePlaceholderPage({ workspaceMode }: { workspaceMode: WorkspaceMode }) {
  const { logout } = useAuthSession();

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
      <section className="w-full max-w-xl rounded-xl border border-border bg-panel p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-sm font-semibold text-primary">
          {workspaceMode.slice(0, 2).toUpperCase()}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{workspaceMode}</h1>
        <p className="mt-3 text-sm text-muted-foreground">This role workspace is coming soon.</p>
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-7 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-4" />
          Logout
        </button>
      </section>
    </div>
  );
}
