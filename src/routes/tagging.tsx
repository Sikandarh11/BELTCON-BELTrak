import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/AppLayout";
import { TaggingStationAgentPanel } from "@/features/stations/TaggingStationAgentPanel";

export const Route = createFileRoute("/tagging")({
  head: () => ({ meta: [{ title: "BELTCON Tagging Station" }] }),
  component: TaggingStation,
});

function TaggingStation() {
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Tagging Station"
        subtitle="Server-controlled RFID verification, bag-photo evidence, and atomic assignment for the active BHS queue bag."
      />
      <TaggingStationAgentPanel />
    </div>
  );
}
