import { createFileRoute } from "@tanstack/react-router";

import { handleRepairAdminProfileRequest } from "@/services/admin/users/adminUserApi.server";

export const Route = createFileRoute("/api/admin/users/$userId/repair-profile")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleRepairAdminProfileRequest(request, params.userId),
    },
  },
});
