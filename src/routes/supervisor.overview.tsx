import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { OperationalDataUnavailable } from "@/components/OperationalDataUnavailable";

export const Route = createFileRoute("/supervisor/overview")({
  head: () => ({ meta: [{ title: "Supervisor Overview · BELTCON SBTS" }] }),
  component: SupervisorOverview,
});

function SupervisorOverview() {
  return (
    <RequireWorkspaceMode modes={["Supervisor"]}>
      <OperationalDataUnavailable
        title="Supervisor Overview"
        subtitle="Escalations, reader health, and operational overrides"
        feature="Supervisor operational overview"
        action={{ to: "/alarms", label: "Open authoritative alarms" }}
      />
    </RequireWorkspaceMode>
  );
}
