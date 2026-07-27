import { createFileRoute } from "@tanstack/react-router";

import {
  handleCreateAdminUserRequest,
  handleListAdminUsersRequest,
} from "@/services/admin/users/adminUserApi.server";

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      GET: ({ request }) => handleListAdminUsersRequest(request),
      POST: ({ request }) => handleCreateAdminUserRequest(request),
    },
  },
});
