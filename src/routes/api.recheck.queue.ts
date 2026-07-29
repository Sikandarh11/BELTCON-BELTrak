import { createFileRoute } from "@tanstack/react-router";
import { handleRecheckQueue } from "@/services/recheck/recheckApi.server";
export const Route = createFileRoute("/api/recheck/queue")({
  server: { handlers: { GET: ({ request }) => handleRecheckQueue(request) } },
});
