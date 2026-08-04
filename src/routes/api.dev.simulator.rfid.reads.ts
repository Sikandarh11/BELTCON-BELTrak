import { createFileRoute } from "@tanstack/react-router";
import { handleRfidSimulatorRead } from "@/services/rfid/rfidSimulatorApi.server";
export const Route = createFileRoute("/api/dev/simulator/rfid/reads")({
  server: {
    handlers: {
      GET: ({ request }) => handleRfidSimulatorRead(request),
      POST: ({ request }) => handleRfidSimulatorRead(request),
    },
  },
});
