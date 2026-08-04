import { createFileRoute } from "@tanstack/react-router";

import { handleStationFaultConsoleRequest } from "@/services/stations/stationFaultConsoleApi.server";

export const Route = createFileRoute("/api/dev/simulator/station-harness")({
  server: {
    handlers: {
      GET: ({ request }) => handleStationFaultConsoleRequest(request),
      POST: ({ request }) => handleStationFaultConsoleRequest(request),
    },
  },
});
