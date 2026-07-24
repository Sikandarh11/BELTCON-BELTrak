import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader } from "@/components/AppLayout";
import { DeveloperSubnav, EventStreamPanel } from "@/features/developer/DeveloperPanels";

export const Route = createFileRoute("/dev/events")({
  head: () => ({ meta: [{ title: "Developer Events · BELTrak" }] }),
  component: DeveloperEvents,
});

function DeveloperEvents() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6">
        <PageHeader
          title="Event Stream"
          subtitle="Live-tail RFID events and fire canonically gated test reads."
        />
        <DeveloperSubnav />
        <EventStreamPanel />
      </div>
    </RequireWorkspaceMode>
  );
}
