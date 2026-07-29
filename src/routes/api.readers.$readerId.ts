import { createFileRoute } from "@tanstack/react-router";

import {
  handleGetReaderRequest,
  handleUpdateReaderRequest,
} from "@/services/readers/readerApi.server";

export const Route = createFileRoute("/api/readers/$readerId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGetReaderRequest(request, params.readerId),
      PATCH: ({ request, params }) => handleUpdateReaderRequest(request, params.readerId),
    },
  },
});
