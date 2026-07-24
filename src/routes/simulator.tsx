import { createFileRoute } from "@tanstack/react-router";

import { SimulatorPanel } from "@/features/simulator/SimulatorPanel";

export const Route = createFileRoute("/simulator")({
  head: () => ({ meta: [{ title: "Simulator · BELTrak" }] }),
  component: SimulatorPanel,
});
