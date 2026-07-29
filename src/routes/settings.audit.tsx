import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/AppLayout";
import { AuditLogPanel } from "@/components/AuditLogPanel";

export const Route = createFileRoute("/settings/audit")({
  head: () => ({ meta: [{ title: "BELTCON Audit Log · BELTCON SBTS" }] }),
  component: SettingsAudit,
});

function SettingsAudit() {
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Audit Log"
        subtitle="Administration and operational audit history use the same authoritative read model."
      />
      <AuditLogPanel />
    </div>
  );
}
