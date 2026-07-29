import { createFileRoute } from "@tanstack/react-router";

import { OperationalDataUnavailable } from "@/components/OperationalDataUnavailable";

export const Route = createFileRoute("/settings/escalations")({
  head: () => ({ meta: [{ title: "Escalations · BELTCON SBTS" }] }),
  component: Escalations,
});

function Escalations() {
  return (
    <OperationalDataUnavailable
      title="Escalation Rules"
      subtitle="Authoritative escalation configuration"
      feature="Escalation configuration"
    />
  );
}
