import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alarmKeys, auditKeys, bagKeys, recheckKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import { AppApiError, readApiResponse } from "@/services/api/appApiError";
import type { HbssRecallInput, RecheckQueueFilters, ResolveRecheckInput } from "./recheckSchemas";
import type { RecheckCase, RecheckQueueItem } from "./recheckTypes";
export { recheckKeys } from "@/lib/queryKeys";
export class RecheckApiError extends AppApiError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, { code });
    this.name = "RecheckApiError";
  }
}
async function response<T>(call: Promise<Response>): Promise<T> {
  const res = await call;
  return readApiResponse<T>(res, "Recheck request failed");
}
export async function fetchQueue(filters: RecheckQueueFilters) {
  const q = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) });
  if (filters.search) q.set("search", filters.search);
  if (filters.alarmStatus) q.set("alarmStatus", filters.alarmStatus);
  if (filters.stationId) q.set("stationId", filters.stationId);
  return response<{ items: RecheckQueueItem[]; total: number }>(
    fetch(`/api/recheck/queue?${q}`, { credentials: "include" }),
  );
}
export const fetchCaseByTag = (tag: string) =>
  response<{ case: RecheckCase }>(
    fetch(`/api/recheck/by-tag/${encodeURIComponent(tag)}`, { credentials: "include" }),
  ).then((body) => body.case);
export const fetchCase = (bagId: string) =>
  response<{ case: RecheckCase }>(
    fetch(`/api/recheck/${encodeURIComponent(bagId)}`, { credentials: "include" }),
  ).then((body) => body.case);
export function useRecheckQueue(filters: RecheckQueueFilters) {
  return useQuery({
    queryKey: recheckKeys.queue(filters),
    queryFn: () => fetchQueue(filters),
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
  });
}
export function useRecheckCaseByTag(tag: string | null) {
  return useQuery({
    queryKey: recheckKeys.caseByTag(tag ?? ""),
    queryFn: () => fetchCaseByTag(tag ?? ""),
    enabled: Boolean(tag),
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
  });
}
export function useRecheckCase(bagId: string | null) {
  return useQuery({
    queryKey: recheckKeys.caseByBag(bagId ?? ""),
    queryFn: () => fetchCase(bagId ?? ""),
    enabled: Boolean(bagId),
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
  });
}
function useInvalidate() {
  const client = useQueryClient();
  return async (bagId: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: recheckKeys.all }),
      client.invalidateQueries({ queryKey: alarmKeys.all }),
      client.invalidateQueries({ queryKey: bagKeys.detail(bagId) }),
      client.invalidateQueries({ queryKey: auditKeys.all }),
    ]);
  };
}
function action<T extends object>(bagId: string, path: string, input: T) {
  return response(
    fetch(`/api/recheck/${encodeURIComponent(bagId)}/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
export function useHbssRecall() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ bagId, input }: { bagId: string; input: HbssRecallInput }) =>
      action(bagId, "hbss-recall", input),
    onSuccess: async (_result, variables) => {
      await invalidate(variables.bagId);
    },
  });
}
export function useResolveRecheckCase() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ bagId, input }: { bagId: string; input: ResolveRecheckInput }) =>
      action(bagId, "resolve", input),
    onSuccess: async (_result, variables) => {
      await invalidate(variables.bagId);
    },
  });
}
