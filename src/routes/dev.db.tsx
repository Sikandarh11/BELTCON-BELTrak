import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader } from "@/components/AppLayout";
import { DbInspectorPanel, DeveloperSubnav } from "@/features/developer/DeveloperPanels";

export const Route = createFileRoute("/dev/db")({
  head: () => ({ meta: [{ title: "DB Inspector · BELTrak" }] }),
  component: DeveloperDb,
});

function DeveloperDb() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6">
        <PageHeader
          title="DB Inspector"
          subtitle="Read-only JSON inspection of the hydrated bags, alarms, and readers stores."
        />
        <DeveloperSubnav />
        <DbInspectorPanel />
      </div>
    </RequireWorkspaceMode>
  );
}
