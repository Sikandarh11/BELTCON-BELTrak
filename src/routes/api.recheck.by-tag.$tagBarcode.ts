import { createFileRoute } from "@tanstack/react-router";
import { handleRecheckTag } from "@/services/recheck/recheckApi.server";
export const Route = createFileRoute("/api/recheck/by-tag/$tagBarcode")({
  server: {
    handlers: { GET: ({ request, params }) => handleRecheckTag(request, params.tagBarcode) },
  },
});
