import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { DeveloperSubnav } from "@/features/developer/DeveloperPanels";
import { SimulatorPanel } from "@/features/simulator/SimulatorPanel";

export const Route = createFileRoute("/dev/simulator")({
  head: () => ({ meta: [{ title: "Developer Simulator · BELTrak" }] }),
  component: DeveloperSimulator,
});

function DeveloperSimulator() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6 pb-0">
        <DeveloperSubnav />
      </div>
      <SimulatorPanel />
    </RequireWorkspaceMode>
  );
}
