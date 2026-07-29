import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alarmKeys, auditKeys, bagKeys, recheckKeys, rfidKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_RETRY, BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import { AppApiError, readApiResponse } from "@/services/api/appApiError";

import type { AlarmDetail, AlarmListResult } from "./alarmRepository.server";
import type {
  AcknowledgeAlarmInput,
  AlarmListFilters,
  EscalateAlarmInput,
  SendToRecheckInput,
} from "./alarmSchemas";

export { alarmKeys } from "@/lib/queryKeys";

export class AlarmApiError extends AppApiError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, { code });
    this.name = "AlarmApiError";
  }
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request;
  return readApiResponse<T>(value, "Alarm request failed");
}

function queryString(filters: AlarmListFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.statuses.length > 0) params.set("status", filters.statuses.join(","));
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.zone) params.set("zone", filters.zone);
  if (filters.search) params.set("search", filters.search);
  if (filters.openedFrom) params.set("openedFrom", filters.openedFrom);
  if (filters.openedTo) params.set("openedTo", filters.openedTo);
  if (filters.assignedTo) params.set("assignedTo", filters.assignedTo);
  return params;
}

export async function fetchAlarms(filters: AlarmListFilters): Promise<AlarmListResult> {
  return response(
    fetch(`/api/alarms?${queryString(filters).toString()}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    }),
  );
}

export async function fetchAlarm(alarmId: string): Promise<AlarmDetail> {
  const body = await response<{ alarm: AlarmDetail }>(
    fetch(`/api/alarms/${encodeURIComponent(alarmId)}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    }),
  );
  return body.alarm;
}

async function mutateAlarm<T extends object>(
  alarmId: string,
  action: "acknowledge" | "escalate" | "send-to-recheck",
  input: T,
) {
  const body = await response<{ alarm: AlarmDetail }>(
    fetch(`/api/alarms/${encodeURIComponent(alarmId)}/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return body.alarm;
}

export function useAlarms(filters: AlarmListFilters) {
  return useQuery({
    queryKey: alarmKeys.list(filters),
    queryFn: () => fetchAlarms(filters),
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
    retry: BELTCON_QUERY_RETRY.read,
    refetchOnWindowFocus: true,
  });
}

export function useAlarm(alarmId: string | null) {
  return useQuery({
    queryKey: alarmKeys.detail(alarmId ?? ""),
    queryFn: () => fetchAlarm(alarmId ?? ""),
    enabled: Boolean(alarmId),
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
  });
}

export function useAlarmActions(alarmId: string | null) {
  return useQuery({
    queryKey: alarmKeys.actions(alarmId ?? ""),
    queryFn: async () => (await fetchAlarm(alarmId ?? "")).actions,
    enabled: Boolean(alarmId),
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
  });
}

function useAlarmInvalidation() {
  const client = useQueryClient();
  return async (alarm: AlarmDetail) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: alarmKeys.lists() }),
      client.invalidateQueries({ queryKey: alarmKeys.detail(alarm.id) }),
      client.invalidateQueries({ queryKey: alarmKeys.actions(alarm.id) }),
      client.invalidateQueries({ queryKey: bagKeys.detail(alarm.bagId) }),
      client.invalidateQueries({ queryKey: rfidKeys.trackableBags() }),
      client.invalidateQueries({ queryKey: recheckKeys.all }),
      client.invalidateQueries({ queryKey: auditKeys.all }),
    ]);
  };
}

export function useAcknowledgeAlarm() {
  const invalidate = useAlarmInvalidation();
  return useMutation({
    mutationFn: ({ alarmId, input }: { alarmId: string; input: AcknowledgeAlarmInput }) =>
      mutateAlarm(alarmId, "acknowledge", input),
    onSuccess: invalidate,
  });
}

export function useEscalateAlarm() {
  const invalidate = useAlarmInvalidation();
  return useMutation({
    mutationFn: ({ alarmId, input }: { alarmId: string; input: EscalateAlarmInput }) =>
      mutateAlarm(alarmId, "escalate", input),
    onSuccess: invalidate,
  });
}

export function useSendToRecheck() {
  const invalidate = useAlarmInvalidation();
  return useMutation({
    mutationFn: ({ alarmId, input }: { alarmId: string; input: SendToRecheckInput }) =>
      mutateAlarm(alarmId, "send-to-recheck", input),
    onSuccess: invalidate,
  });
}
