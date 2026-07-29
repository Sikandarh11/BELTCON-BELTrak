import { createFileRoute } from "@tanstack/react-router";

import { OperationalDataUnavailable } from "@/components/OperationalDataUnavailable";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Tag History · BELTCON SBTS" }] }),
  component: History,
});

function History() {
  return (
    <OperationalDataUnavailable
      title="Query Tag History"
      subtitle="Searchable RFID event history"
      feature="RFID event history"
      action={{ to: "/dev/simulator", label: "Open RFID simulator" }}
    />
  );
}
