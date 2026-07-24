import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { PageHeader } from "@/components/AppLayout";
import { DeveloperSubnav, FeatureFlagsPanel } from "@/features/developer/DeveloperPanels";

export const Route = createFileRoute("/dev/flags")({
  head: () => ({ meta: [{ title: "Feature Flags · BELTrak" }] }),
  component: DeveloperFlags,
});

function DeveloperFlags() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6">
        <PageHeader
          title="Feature Flags"
          subtitle="Client-side developer preferences stored under sbts.flags."
        />
        <DeveloperSubnav />
        <FeatureFlagsPanel />
      </div>
    </RequireWorkspaceMode>
  );
}
