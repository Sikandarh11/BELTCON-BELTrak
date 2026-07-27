import { createFileRoute } from "@tanstack/react-router";

import { handleAdminUserActionRequest } from "@/services/admin/users/adminUserApi.server";

export const Route = createFileRoute("/api/admin/users/$userId/actions")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleAdminUserActionRequest(request, params.userId),
    },
  },
});
