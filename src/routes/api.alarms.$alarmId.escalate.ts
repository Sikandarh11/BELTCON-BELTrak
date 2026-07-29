import { createFileRoute } from "@tanstack/react-router";

import { handleEscalateAlarmRequest } from "@/services/alarms/alarmApi.server";

export const Route = createFileRoute("/api/alarms/$alarmId/escalate")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleEscalateAlarmRequest(request, params.alarmId),
    },
  },
});
