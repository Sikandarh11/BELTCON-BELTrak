import { createFileRoute } from "@tanstack/react-router";

import { handleScreeningSimulatorRequest } from "@/services/screening/screeningSimulatorApi.server";

export const Route = createFileRoute("/api/dev/simulator/suspect-events")({
  server: {
    handlers: {
      POST: ({ request }) => handleScreeningSimulatorRequest(request),
    },
  },
});
