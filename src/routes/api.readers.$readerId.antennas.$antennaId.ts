import { createFileRoute } from "@tanstack/react-router";

import { handleUpdateAntennaRequest } from "@/services/readers/readerApi.server";

export const Route = createFileRoute("/api/readers/$readerId/antennas/$antennaId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handleUpdateAntennaRequest(request, params.readerId, params.antennaId),
    },
  },
});
