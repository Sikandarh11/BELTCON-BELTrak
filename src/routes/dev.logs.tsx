import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader } from "@/components/AppLayout";
import { DeveloperSubnav, ErrorLogPanel } from "@/features/developer/DeveloperPanels";

export const Route = createFileRoute("/dev/logs")({
  head: () => ({ meta: [{ title: "Logs & Traces · BELTrak" }] }),
  component: DeveloperLogs,
});

function DeveloperLogs() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6">
        <PageHeader
          title="Logs & Traces"
          subtitle="Recent client errors captured by the shared error boundary utility."
        />
        <DeveloperSubnav />
        <ErrorLogPanel />
      </div>
    </RequireWorkspaceMode>
  );
}
