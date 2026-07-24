import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/dev/console")({
  head: () => ({ meta: [{ title: "Developer · BELTrak" }] }),
  component: DeveloperConsole,
});

function DeveloperConsole() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <RolePlaceholderPage workspaceMode="Developer" />
    </RequireWorkspaceMode>
  );
}
