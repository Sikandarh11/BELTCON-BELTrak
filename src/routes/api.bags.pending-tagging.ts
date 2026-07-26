import { createFileRoute } from "@tanstack/react-router";

import { handlePendingTaggingRequest } from "@/services/bags/taggingApi.server";

export const Route = createFileRoute("/api/bags/pending-tagging")({
  server: {
    handlers: {
      GET: ({ request }) => handlePendingTaggingRequest(request),
    },
  },
});
