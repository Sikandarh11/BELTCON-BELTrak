import { createFileRoute } from "@tanstack/react-router";

import { OperationalDataUnavailable } from "@/components/OperationalDataUnavailable";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Operations Dashboard · BELTCON SBTS" }] }),
  component: Dashboard,
});

function Dashboard() {
  return (
    <OperationalDataUnavailable
      title="Operations Dashboard"
      subtitle="BELTCON SBTS operational overview"
      feature="Operations dashboard"
      action={{ to: "/alarms", label: "Open authoritative alarms" }}
    />
  );
}
