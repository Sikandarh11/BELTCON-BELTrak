import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { OperationalDataUnavailable } from "@/components/OperationalDataUnavailable";

export const Route = createFileRoute("/ops/scan")({
  head: () => ({ meta: [{ title: "Operator Scan · BELTCON SBTS" }] }),
  component: OperatorScan,
});

function OperatorScan() {
  return (
    <RequireWorkspaceMode modes={["Operator"]}>
      <OperationalDataUnavailable
        title="Operator Scan"
        subtitle="RFID scan workflow"
        feature="Operator scan"
        action={{ to: "/recheck", label: "Open authoritative Recheck queue" }}
      />
    </RequireWorkspaceMode>
  );
}
