import { createFileRoute } from "@tanstack/react-router";

import { handleScreeningSuspectEventRequest } from "@/services/screening/screeningApi.server";

export const Route = createFileRoute("/api/integrations/screening/suspect-events")({
  server: {
    handlers: {
      POST: ({ request }) => handleScreeningSuspectEventRequest(request),
    },
  },
});
