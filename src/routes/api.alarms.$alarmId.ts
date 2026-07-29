import { createFileRoute } from "@tanstack/react-router";

import { handleGetAlarmRequest } from "@/services/alarms/alarmApi.server";

export const Route = createFileRoute("/api/alarms/$alarmId")({
  server: {
    handlers: { GET: ({ request, params }) => handleGetAlarmRequest(request, params.alarmId) },
  },
});
