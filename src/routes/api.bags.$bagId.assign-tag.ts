import { createFileRoute } from "@tanstack/react-router";

import { handleAssignRfidTagRequest } from "@/services/bags/taggingApi.server";

export const Route = createFileRoute("/api/bags/$bagId/assign-tag")({
  server: {
    handlers: { POST: ({ request, params }) => handleAssignRfidTagRequest(request, params.bagId) },
  },
});
