import { createFileRoute } from "@tanstack/react-router";
import { handleRecall } from "@/services/recheck/recheckApi.server";
export const Route = createFileRoute("/api/recheck/$bagId/hbss-recall")({
  server: { handlers: { POST: ({ request, params }) => handleRecall(request, params.bagId) } },
});
