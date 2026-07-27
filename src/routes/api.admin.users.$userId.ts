import { createFileRoute } from "@tanstack/react-router";

import { handleEditAdminUserRequest } from "@/services/admin/users/adminUserApi.server";

export const Route = createFileRoute("/api/admin/users/$userId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handleEditAdminUserRequest(request, params.userId),
    },
  },
});
