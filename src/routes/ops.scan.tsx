import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/ops/scan")({
  head: () => ({ meta: [{ title: "Operator · BELTrak" }] }),
  component: OperatorScan,
});

function OperatorScan() {
  return (
    <RequireWorkspaceMode modes={["Operator"]}>
      <RolePlaceholderPage workspaceMode="Operator" />
    </RequireWorkspaceMode>
  );
}
