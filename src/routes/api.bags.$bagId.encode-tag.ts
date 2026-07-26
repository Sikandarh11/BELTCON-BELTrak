import { createFileRoute } from "@tanstack/react-router";

import { handleEncodeTagRequest } from "@/services/bags/taggingApi.server";

export const Route = createFileRoute("/api/bags/$bagId/encode-tag")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleEncodeTagRequest(request, params.bagId),
    },
  },
});
