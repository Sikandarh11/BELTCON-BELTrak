import { createFileRoute } from "@tanstack/react-router";

import { handleExportAuditEventsRequest } from "@/services/audit/auditApi.server";

export const Route = createFileRoute("/api/audit/events/export/csv")({
  server: { handlers: { GET: ({ request }) => handleExportAuditEventsRequest(request) } },
});
