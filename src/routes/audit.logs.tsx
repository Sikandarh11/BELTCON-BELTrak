import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/audit/logs")({
  head: () => ({ meta: [{ title: "Auditor · BELTrak" }] }),
  component: AuditorLogs,
});

function AuditorLogs() {
  return (
    <RequireWorkspaceMode modes={["Auditor"]}>
      <RolePlaceholderPage workspaceMode="Auditor" />
    </RequireWorkspaceMode>
  );
}
