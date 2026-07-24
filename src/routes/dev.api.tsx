import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader } from "@/components/AppLayout";
import { ApiExplorerPanel, DeveloperSubnav } from "@/features/developer/DeveloperPanels";

export const Route = createFileRoute("/dev/api")({
  head: () => ({ meta: [{ title: "API Explorer · BELTrak" }] }),
  component: DeveloperApi,
});

function DeveloperApi() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6">
        <PageHeader
          title="API Explorer"
          subtitle="Inspect the six authentication endpoints using the current cookie-backed session."
        />
        <DeveloperSubnav />
        <ApiExplorerPanel />
      </div>
    </RequireWorkspaceMode>
  );
}
