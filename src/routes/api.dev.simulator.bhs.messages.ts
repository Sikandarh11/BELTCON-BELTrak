import { createFileRoute } from "@tanstack/react-router";

import { handleBhsSimulatorRequest } from "@/services/bhs/bhsSimulatorApi.server";

export const Route = createFileRoute("/api/dev/simulator/bhs/messages")({
  server: { handlers: { POST: ({ request }) => handleBhsSimulatorRequest(request) } },
});
