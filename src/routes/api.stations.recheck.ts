import { createFileRoute } from "@tanstack/react-router";

import { handleRecheckStationAgentRequest } from "@/services/stations/hbss/recheckStationApi.server";

export const Route = createFileRoute("/api/stations/recheck")({
  server: {
    handlers: {
      GET: ({ request }) => handleRecheckStationAgentRequest(request),
      POST: ({ request }) => handleRecheckStationAgentRequest(request),
    },
  },
});
