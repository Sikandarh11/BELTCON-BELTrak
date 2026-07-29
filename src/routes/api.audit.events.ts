import { createFileRoute } from "@tanstack/react-router";

import { handleListAuditEventsRequest } from "@/services/audit/auditApi.server";

export const Route = createFileRoute("/api/audit/events")({
  server: { handlers: { GET: ({ request }) => handleListAuditEventsRequest(request) } },
});
