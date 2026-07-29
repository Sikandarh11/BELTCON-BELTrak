import { useQuery } from "@tanstack/react-query";

import { auditKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_RETRY, BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import { readApiResponse } from "@/services/api/appApiError";

import type { AuditEventDetail, AuditFilters, AuditListResponse } from "./auditSchemas";

function queryString(filters: AuditFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}
export async function fetchAuditEvents(filters: AuditFilters) {
  return readApiResponse<AuditListResponse>(
    await fetch(`/api/audit/events${queryString(filters)}`, { credentials: "include" }),
    "Unable to load audit events",
  );
}
export async function fetchAuditEvent(auditId: string) {
  const response = await readApiResponse<{ event: AuditEventDetail }>(
    await fetch(`/api/audit/events/${encodeURIComponent(auditId)}`, { credentials: "include" }),
    "Unable to load audit event",
  );
  return response.event;
}
export function useAuditEvents(filters: AuditFilters) {
  return useQuery({
    queryKey: auditKeys.list(filters),
    queryFn: () => fetchAuditEvents(filters),
    staleTime: BELTCON_QUERY_STALE_TIME.audit,
    retry: BELTCON_QUERY_RETRY.read,
  });
}
export function useAuditEvent(auditId: string | null) {
  return useQuery({
    queryKey: auditKeys.detail(auditId ?? "none"),
    queryFn: () => fetchAuditEvent(auditId!),
    enabled: Boolean(auditId),
    staleTime: BELTCON_QUERY_STALE_TIME.audit,
    retry: BELTCON_QUERY_RETRY.read,
  });
}
