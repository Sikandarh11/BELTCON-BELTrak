import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeveloperSubnav } from "@/features/developer/DeveloperPanels";
import { ScreeningHbssSimulator } from "@/features/simulator/ScreeningHbssSimulator";
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
        <Tabs defaultValue="screening">
          <TabsList aria-label="Simulator type">
            <TabsTrigger value="screening">Screening/HBSS Simulator</TabsTrigger>
            <TabsTrigger value="rfid">RFID Journey Simulator</TabsTrigger>
          </TabsList>
          <TabsContent value="screening" className="-mx-6">
            <ScreeningHbssSimulator />
          </TabsContent>
          <TabsContent value="rfid" className="-mx-6">
            <SimulatorPanel />
          </TabsContent>
        </Tabs>
      </div>
    </RequireWorkspaceMode>
  );
}
