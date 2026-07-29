import { createFileRoute } from "@tanstack/react-router";

import { handleSendToRecheckRequest } from "@/services/alarms/alarmApi.server";

export const Route = createFileRoute("/api/alarms/$alarmId/send-to-recheck")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleSendToRecheckRequest(request, params.alarmId),
    },
  },
});
