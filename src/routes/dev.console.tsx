import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader } from "@/components/AppLayout";
import { DeveloperConsoleGrid, DeveloperSubnav } from "@/features/developer/DeveloperPanels";

export const Route = createFileRoute("/dev/console")({
  head: () => ({ meta: [{ title: "Developer Console · BELTrak" }] }),
  component: DeveloperConsole,
});

function DeveloperConsole() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6">
        <PageHeader
          title="Developer Console"
          subtitle="Read-only runtime diagnostics with canonically gated developer actions."
        />
        <DeveloperSubnav />
        <DeveloperConsoleGrid />
      </div>
    </RequireWorkspaceMode>
  );
}
