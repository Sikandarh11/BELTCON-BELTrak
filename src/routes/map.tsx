import { createFileRoute } from "@tanstack/react-router";

import { OperationalDataUnavailable } from "@/components/OperationalDataUnavailable";

export const Route = createFileRoute("/map")({
  head: () => ({ meta: [{ title: "Operations Map · BELTCON SBTS" }] }),
  component: Map,
});

function Map() {
  return (
    <OperationalDataUnavailable
      title="Live Operations Map"
      subtitle="Current bag and reader locations"
      feature="Live map"
      action={{ to: "/readers", label: "Open reader status" }}
    />
  );
}
