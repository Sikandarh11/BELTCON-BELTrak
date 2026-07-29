import { createFileRoute } from "@tanstack/react-router";

import { handleListReadersRequest } from "@/services/readers/readerApi.server";

export const Route = createFileRoute("/api/readers")({
  server: { handlers: { GET: ({ request }) => handleListReadersRequest(request) } },
});
