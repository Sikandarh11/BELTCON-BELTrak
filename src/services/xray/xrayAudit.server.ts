import "@tanstack/react-start/server-only";

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
 * The current application audit store is browser-only mock state. Server
 * integration events therefore go to structured platform logs until a
 * durable audit table/repository exists.
 */
export function recordXrayAudit(event: XrayAuditEvent) {
  const entry = {
    category: "XRAY_INTEGRATION",
    occurredAt: new Date().toISOString(),
    ...event,
  };

  if (event.action === "XRAY_SCAN_RETRIEVAL_FAILED") {
    console.warn("[BELTrak audit]", entry);
    return;
  }

  console.info("[BELTrak audit]", entry);
}
