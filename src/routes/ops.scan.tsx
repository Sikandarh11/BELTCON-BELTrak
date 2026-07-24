import { createFileRoute } from "@tanstack/react-router";

import { RequireRole } from "@/auth/RequireRole";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/ops/scan")({
  head: () => ({ meta: [{ title: "Operator · BELTrak" }] }),
  component: OperatorScan,
});

function OperatorScan() {
  return (
    <RequireRole roles={["Operator"]}>
      <RolePlaceholderPage role="Operator" />
    </RequireRole>
  );
}
