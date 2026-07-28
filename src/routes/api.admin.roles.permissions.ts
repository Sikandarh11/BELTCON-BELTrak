import { createFileRoute } from "@tanstack/react-router";

import { handleGetRolePermissionsRequest } from "@/services/admin/roles/roleApi.server";

export const Route = createFileRoute("/api/admin/roles/permissions")({
  server: {
    handlers: {
      GET: ({ request }) => handleGetRolePermissionsRequest(request),
    },
  },
});
