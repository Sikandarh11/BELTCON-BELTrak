import { createFileRoute } from "@tanstack/react-router";

import { handleHbssHealthRequest } from "@/services/xray/xrayApi.server";

export const Route = createFileRoute("/api/integrations/hbss/health")({
  server: {
    handlers: {
      GET: () => handleHbssHealthRequest(),
    },
  },
});
