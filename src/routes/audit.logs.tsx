import { createFileRoute } from "@tanstack/react-router";

import { RequireRole } from "@/auth/RequireRole";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/audit/logs")({
  head: () => ({ meta: [{ title: "Auditor · BELTrak" }] }),
  component: AuditorLogs,
});

function AuditorLogs() {
  return (
    <RequireRole roles={["Auditor"]}>
      <RolePlaceholderPage role="Auditor" />
    </RequireRole>
  );
}
