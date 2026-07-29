import { createFileRoute } from "@tanstack/react-router";

import { handleListAlarmsRequest } from "@/services/alarms/alarmApi.server";

export const Route = createFileRoute("/api/alarms")({
  server: { handlers: { GET: ({ request }) => handleListAlarmsRequest(request) } },
});
