import { createFileRoute } from "@tanstack/react-router";

import { handleBhsPendingConfirmationsRequest } from "@/services/bhs/bhsSimulatorApi.server";

export const Route = createFileRoute("/api/dev/simulator/bhs/pending-confirmations")({
  server: {
    handlers: {
      GET: ({ request }) => handleBhsPendingConfirmationsRequest(request),
    },
  },
});
