import { createFileRoute } from "@tanstack/react-router";

import { handleSetReaderEnabledRequest } from "@/services/readers/readerApi.server";

export const Route = createFileRoute("/api/readers/$readerId/enabled")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleSetReaderEnabledRequest(request, params.readerId),
    },
  },
});