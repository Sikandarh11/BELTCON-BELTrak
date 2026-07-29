import { createFileRoute } from "@tanstack/react-router";
import { handleRecheckCase } from "@/services/recheck/recheckApi.server";
export const Route = createFileRoute("/api/recheck/$bagId")({
  server: { handlers: { GET: ({ request, params }) => handleRecheckCase(request, params.bagId) } },
});
