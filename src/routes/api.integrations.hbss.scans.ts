import { createFileRoute } from "@tanstack/react-router";

import { handleHbssIngestionRequest } from "@/services/xray/xrayApi.server";

export const Route = createFileRoute("/api/integrations/hbss/scans")({
  server: {
    handlers: {
      POST: ({ request }) => handleHbssIngestionRequest(request),
    },
  },
});
