import { createFileRoute } from "@tanstack/react-router";

import { handleCreateReaderRequest, handleListReadersRequest } from "@/services/readers/readerApi.server";

export const Route = createFileRoute("/api/readers")({
  server: {
    handlers: {
      GET: ({ request }) => handleListReadersRequest(request),
      POST: ({ request }) => handleCreateReaderRequest(request),
    },
  },
});
