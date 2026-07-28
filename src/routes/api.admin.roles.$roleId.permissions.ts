import { createFileRoute } from "@tanstack/react-router";

import { handleUpdateRolePermissionsRequest } from "@/services/admin/roles/roleApi.server";

export const Route = createFileRoute("/api/admin/roles/$roleId/permissions")({
  server: {
    handlers: {
      PUT: ({ request, params }) => handleUpdateRolePermissionsRequest(request, params.roleId),
    },
  },
});
