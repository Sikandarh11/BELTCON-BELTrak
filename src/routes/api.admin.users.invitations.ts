import { createFileRoute } from "@tanstack/react-router";

import { handleInviteAdminUserRequest } from "@/services/admin/users/adminUserApi.server";

export const Route = createFileRoute("/api/admin/users/invitations")({
  server: {
    handlers: {
      POST: ({ request }) => handleInviteAdminUserRequest(request),
    },
  },
});
