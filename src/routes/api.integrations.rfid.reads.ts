import { createFileRoute } from "@tanstack/react-router";
import { handleRfidIntegrationRead } from "@/services/rfid/rfidReadApi.server";
export const Route = createFileRoute("/api/integrations/rfid/reads")({
  server: { handlers: { POST: ({ request }) => handleRfidIntegrationRead(request) } },
});
