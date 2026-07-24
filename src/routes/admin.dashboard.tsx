import { createFileRoute } from "@tanstack/react-router";

import { RequireRole } from "@/auth/RequireRole";
import { RolePlaceholderPage } from "@/components/RolePlaceholderPage";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin · BELTrak" }] }),
  component: AdminDashboard,
});

function AdminDashboard() {
  return (
    <RequireRole roles={["Admin"]}>
      <RolePlaceholderPage role="Admin" />
    </RequireRole>
  );
}
