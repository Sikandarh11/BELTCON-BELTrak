import { createFileRoute } from "@tanstack/react-router";

import { handleGetAuditEventRequest } from "@/services/audit/auditApi.server";

export const Route = createFileRoute("/api/audit/events/$auditId")({
  server: {
    handlers: { GET: ({ request, params }) => handleGetAuditEventRequest(request, params.auditId) },
  },
});
