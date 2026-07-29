import { createFileRoute } from "@tanstack/react-router";
import { handleResolve } from "@/services/recheck/recheckApi.server";
export const Route = createFileRoute("/api/recheck/$bagId/resolve")({
  server: { handlers: { POST: ({ request, params }) => handleResolve(request, params.bagId) } },
});
