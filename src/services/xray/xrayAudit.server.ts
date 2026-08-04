import "@tanstack/react-start/server-only";

import { getXrayAdminClient } from "./xraySupabase.server";

export type XrayAuditEvent =
  | {
      action: "XRAY_REFRESH_REQUESTED";
      bagId: string;
      bhsUid: string;
    }
  | {
      action: "XRAY_SCAN_RECEIVED";
      bagId: string;
      bhsUid: string;
      sourceSystem: string;
      status: string;
    }
  | {
      action: "XRAY_SCAN_RETRIEVAL_FAILED";
      bagId: string;
      bhsUid?: string;
      errorCode: string;
    };

/**
 * Persist sanitized integration evidence. Audit failure is logged but never
 * replaces the primary HBSS/X-ray result.
 */
export async function recordXrayAudit(event: XrayAuditEvent) {
  const entry = {
    category: "XRAY_INTEGRATION",
    occurredAt: new Date().toISOString(),
    ...event,
  };

  try {
    const sourceSystem = event.action === "XRAY_SCAN_RECEIVED" ? event.sourceSystem : "HBSS";
    const { error } = await getXrayAdminClient()
      .from("audit_events")
      .insert({
        action: event.action,
        actor_type: "INTEGRATION",
        actor_id: sourceSystem,
        bag_id: event.bagId,
        source_system: sourceSystem,
        outcome: event.action === "XRAY_SCAN_RETRIEVAL_FAILED" ? "FAILED" : "SUCCESS",
        error_code: event.action === "XRAY_SCAN_RETRIEVAL_FAILED" ? event.errorCode : null,
        metadata: {
          ...(event.bhsUid ? { bhsUid: event.bhsUid } : {}),
          ...(event.action === "XRAY_SCAN_RECEIVED"
            ? { scanSourceSystem: event.sourceSystem, scanStatus: event.status }
            : {}),
        },
        created_at: entry.occurredAt,
      });
    if (error) throw error;
  } catch {
    console.warn("[BELTrak audit persistence failed]", {
      action: event.action,
      errorCode: "XRAY_AUDIT_PERSIST_FAILED",
    });
  }

  if (event.action === "XRAY_SCAN_RETRIEVAL_FAILED") {
    console.warn("[BELTrak audit]", entry);
    return;
  }

  console.info("[BELTrak audit]", entry);
}
