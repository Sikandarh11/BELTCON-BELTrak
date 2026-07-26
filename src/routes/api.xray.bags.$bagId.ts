import { createFileRoute } from "@tanstack/react-router";

import { handleGetBagXrayRequest } from "@/services/xray/xrayApi.server";

export const Route = createFileRoute("/api/xray/bags/$bagId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGetBagXrayRequest(request, params.bagId),
    },
  },
});
