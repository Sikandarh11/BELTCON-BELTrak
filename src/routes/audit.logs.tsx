import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/AppLayout";
import { AuditLogPanel } from "@/components/AuditLogPanel";

export const Route = createFileRoute("/audit/logs")({
  head: () => ({ meta: [{ title: "BELTCON Audit Log · BELTCON SBTS" }] }),
  component: AuditLogs,
});

function AuditLogs() {
  return (
    <div className="p-6">
      <PageHeader
        title="BELTCON Audit Log"
        subtitle="Durable server-generated security and operational history."
      />
      <AuditLogPanel />
    </div>
  );
}
