import { createFileRoute } from "@tanstack/react-router";

import { handleTaggingStationAgentRequest } from "@/services/stations/bhs/taggingStationApi.server";

export const Route = createFileRoute("/api/stations/tagging")({
  server: {
    handlers: {
      GET: ({ request }) => handleTaggingStationAgentRequest(request),
      POST: ({ request }) => handleTaggingStationAgentRequest(request),
    },
  },
});
