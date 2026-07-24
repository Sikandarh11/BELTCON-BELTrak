import { createFileRoute } from "@tanstack/react-router";

import { RequireRole } from "@/auth/RequireRole";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/dev/console")({
  head: () => ({ meta: [{ title: "Developer · BELTrak" }] }),
  component: DeveloperConsole,
});

function DeveloperConsole() {
  return (
    <RequireRole roles={["Developer"]}>
      <RolePlaceholderPage role="Developer" />
    </RequireRole>
  );
}
