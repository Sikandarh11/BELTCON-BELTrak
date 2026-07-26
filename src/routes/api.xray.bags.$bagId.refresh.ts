import { createFileRoute } from "@tanstack/react-router";

import { handleRefreshBagXrayRequest } from "@/services/xray/xrayApi.server";

export const Route = createFileRoute("/api/xray/bags/$bagId/refresh")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleRefreshBagXrayRequest(request, params.bagId),
    },
  },
});
