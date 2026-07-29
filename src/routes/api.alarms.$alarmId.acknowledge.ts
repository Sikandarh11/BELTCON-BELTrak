import { createFileRoute } from "@tanstack/react-router";

import { handleAcknowledgeAlarmRequest } from "@/services/alarms/alarmApi.server";

export const Route = createFileRoute("/api/alarms/$alarmId/acknowledge")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleAcknowledgeAlarmRequest(request, params.alarmId),
    },
  },
});
