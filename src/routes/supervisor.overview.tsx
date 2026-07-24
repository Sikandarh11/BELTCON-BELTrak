import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/supervisor/overview")({
  head: () => ({ meta: [{ title: "Supervisor · BELTrak" }] }),
  component: SupervisorOverview,
});

function SupervisorOverview() {
  return (
    <RequireWorkspaceMode modes={["Supervisor"]}>
      <RolePlaceholderPage workspaceMode="Supervisor" />
    </RequireWorkspaceMode>
  );
}
