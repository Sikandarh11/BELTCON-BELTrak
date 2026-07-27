import "@tanstack/react-start/server-only";

import { XrayPersistenceError, XrayValidationError } from "./xrayErrors";
import { getXrayAdminClient } from "./xraySupabase.server";

export interface XrayViewedAuditInput {
  userId: string;
  canonicalRole: string;
  bagId: string;
  scanId: string;
  sourceSystem: string;
  requestId: string;
  timestamp: string;
}

export type XrayViewAuditResult = "CREATED" | "DUPLICATE";

type AuditWriteError = {
  code?: string;
  message?: string;
};

type AuditWriter = (row: Record<string, unknown>) => Promise<{ error: AuditWriteError | null }>;

export interface XrayViewAuditRepository {
  recordViewed(input: XrayViewedAuditInput): Promise<XrayViewAuditResult>;
}

function normalizedRequired(value: string, label: string, maximumLength = 256) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new XrayValidationError(`A valid ${label} is required`);
  }
  return normalized;
}

const defaultWriter: AuditWriter = async (row) => {
  const { error } = await getXrayAdminClient().from("audit_events").insert(row);
  return { error };
};

export function createXrayViewAuditRepository(
  writer: AuditWriter = defaultWriter,
): XrayViewAuditRepository {
  return {
    async recordViewed(input) {
      const row = {
        action: "XRAY_VIEWED",
        actor_type: "USER",
        actor_id: normalizedRequired(input.userId, "user ID"),
        canonical_role: normalizedRequired(input.canonicalRole, "canonical role"),
        bag_id: normalizedRequired(input.bagId, "bag ID", 128),
        xray_scan_id: normalizedRequired(input.scanId, "scan ID", 128),
        source_system: normalizedRequired(input.sourceSystem, "scan source"),
        outcome: "SUCCESS",
        request_id: normalizedRequired(input.requestId, "request ID", 128),
        metadata: {},
        created_at: normalizedRequired(input.timestamp, "timestamp", 64),
      };

      const { error } = await writer(row);
      if (!error) {
        return "CREATED";
      }

      // The database unique index makes a repeated view-session request
      // idempotent across server instances and concurrent requests.
      if (error.code === "23505") {
        return "DUPLICATE";
      }

      throw new XrayPersistenceError("Unable to record the X-ray view audit event", {
        cause: error,
      });
    },
  };
}

export const xrayViewAuditRepository = createXrayViewAuditRepository();
