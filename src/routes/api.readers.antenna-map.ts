import { createFileRoute } from "@tanstack/react-router";
import { handleReaderAntennaMapRequest } from "@/services/rfid/readerAntennaApi.server";
export const Route = createFileRoute("/api/readers/antenna-map")({
  server: { handlers: { GET: ({ request }) => handleReaderAntennaMapRequest(request) } },
});
