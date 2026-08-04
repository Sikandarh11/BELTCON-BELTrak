import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeveloperSubnav } from "@/features/developer/DeveloperPanels";
import { ScreeningHbssSimulator } from "@/features/simulator/ScreeningHbssSimulator";
import { StationIntegrationFaultConsole } from "@/features/simulator/StationIntegrationFaultConsole";
import { SimulatorPanel } from "@/features/simulator/SimulatorPanel";
import { BeltconBhsSimulator } from "@/features/simulator/BeltconBhsSimulator";

export const Route = createFileRoute("/dev/simulator")({
  head: () => ({ meta: [{ title: "Developer Simulator · BELTCON SBTS" }] }),
  component: DeveloperSimulator,
});

function DeveloperSimulator() {
  return (
    <RequireWorkspaceMode modes={["Developer"]}>
      <div className="p-6 pb-0">
        <DeveloperSubnav />
        <Tabs defaultValue="bhs">
          <TabsList aria-label="Simulator type">
            <TabsTrigger value="bhs">BELTCON BHS Simulator</TabsTrigger>
            <TabsTrigger value="screening">BELTCON HBSS Simulator</TabsTrigger>
            <TabsTrigger value="rfid">RFID Journey Simulator</TabsTrigger>
            <TabsTrigger value="station-fat">Station Software FAT</TabsTrigger>
          </TabsList>
          <TabsContent value="bhs" className="-mx-6">
            <BeltconBhsSimulator />
          </TabsContent>
          <TabsContent value="screening" className="-mx-6">
            <ScreeningHbssSimulator />
          </TabsContent>
          <TabsContent value="rfid" className="-mx-6">
            <SimulatorPanel />
          </TabsContent>
          <TabsContent value="station-fat" className="-mx-6">
            <StationIntegrationFaultConsole />
          </TabsContent>
        </Tabs>
      </div>
    </RequireWorkspaceMode>
  );
}
