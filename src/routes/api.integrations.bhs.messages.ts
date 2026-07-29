import { createFileRoute } from "@tanstack/react-router";

import { handleBhsMessageRequest } from "@/services/bhs/bhsMessageApi.server";

export const Route = createFileRoute("/api/integrations/bhs/messages")({
  server: {
    handlers: {
      POST: ({ request }) => handleBhsMessageRequest(request),
    },
  },
});
