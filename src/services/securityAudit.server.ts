import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import type { CanonicalRole } from "@/auth/canonicalRoles";
import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";

export type AccessDeniedAuditInput = {
  actorId: string;
  canonicalRole: CanonicalRole;
  requiredRole: CanonicalRole;
  resource: string;
  method: string;
  requestId?: string;
  timestamp?: string;
};

export async function recordAccessDenied(input: AccessDeniedAuditInput) {
  const { error } = await getSupabaseAdminClient()
    .from("audit_events")
    .insert({
      action: "ACCESS_DENIED",
      actor_type: "USER",
      actor_id: input.actorId,
      canonical_role: input.canonicalRole,
      source_system: "BELTRAK_AUTHORIZATION",
      outcome: "DENIED",
      request_id: input.requestId ?? randomUUID(),
      metadata: {
        requiredRole: input.requiredRole,
        resource: input.resource,
        method: input.method,
      },
      created_at: input.timestamp ?? new Date().toISOString(),
    });

  if (error) {
    throw new Error("Unable to persist the access-denied audit event", { cause: error });
  }
}
