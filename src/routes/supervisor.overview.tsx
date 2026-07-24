import { createFileRoute } from "@tanstack/react-router";

import { RequireRole } from "@/auth/RequireRole";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/supervisor/overview")({
  head: () => ({ meta: [{ title: "Supervisor · BELTrak" }] }),
  component: SupervisorOverview,
});

function SupervisorOverview() {
  return (
    <RequireRole roles={["Supervisor"]}>
      <RolePlaceholderPage role="Supervisor" />
    </RequireRole>
  );
}
