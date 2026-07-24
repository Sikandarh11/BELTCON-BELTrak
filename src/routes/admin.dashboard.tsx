import { createFileRoute } from "@tanstack/react-router";

import { RequireWorkspaceMode } from "@/auth/RequireWorkspaceMode";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin · BELTrak" }] }),
  component: AdminDashboard,
});

function AdminDashboard() {
  return (
    <RequireWorkspaceMode modes={["Admin"]}>
      <RolePlaceholderPage workspaceMode="Admin" />
    </RequireWorkspaceMode>
  );
}
