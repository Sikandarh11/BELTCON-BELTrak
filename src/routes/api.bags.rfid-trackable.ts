import { createFileRoute } from "@tanstack/react-router";

import { handleRfidTrackableBagsRequest } from "@/services/bags/rfidTrackableApi.server";

export const Route = createFileRoute("/api/bags/rfid-trackable")({
  server: {
    handlers: {
      GET: ({ request }) => handleRfidTrackableBagsRequest(request),
    },
  },
});
