import { createFileRoute } from "@tanstack/react-router";

import { handleBhsPendingConfirmationRequest } from "@/services/bhs/bhsSimulatorApi.server";

export const Route = createFileRoute("/api/dev/simulator/bhs/pending-confirmations/$bagId/confirm")(
  {
    server: {
      handlers: {
        POST: ({ request, params }) => handleBhsPendingConfirmationRequest(request, params.bagId),
      },
    },
  },
);
