import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { reportKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_RETRY } from "@/lib/queryPolicy";
import { readApiResponse } from "@/services/api/appApiError";

import type { OperationalReport, ReportFilters, ReportType } from "./reportSchemas";

function queryString(filters: ReportFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export async function fetchOperationalReport(reportType: ReportType, filters: ReportFilters) {
  return readApiResponse<OperationalReport>(
    await fetch(`/api/reports/${reportType}${queryString(filters)}`, { credentials: "include" }),
    "Unable to load operational report",
  );
}

function hook(reportType: ReportType, key: (filters: ReportFilters) => readonly unknown[]) {
  return (filters: ReportFilters, enabled = true): UseQueryResult<OperationalReport, Error> =>
    useQuery<OperationalReport>({
      queryKey: key(filters),
      queryFn: () => fetchOperationalReport(reportType, filters),
      enabled,
      staleTime: 60_000,
      retry: BELTCON_QUERY_RETRY.read,
    });
}

function keyFor(reportType: ReportType, filters: ReportFilters) {
  switch (reportType) {
    case "bag-lifecycle":
      return reportKeys.bagLifecycle(filters);
    case "tagging":
      return reportKeys.tagging(filters);
    case "rfid":
      return reportKeys.rfid(filters);
    case "alarms":
      return reportKeys.alarms(filters);
    case "recheck":
      return reportKeys.recheck(filters);
    case "readers":
      return reportKeys.readers(filters);
    case "integrations":
      return reportKeys.integrations(filters);
  }
}

export function useOperationalReport(reportType: ReportType, filters: ReportFilters) {
  return useQuery<OperationalReport>({
    queryKey: keyFor(reportType, filters),
    queryFn: () => fetchOperationalReport(reportType, filters),
    staleTime: 60_000,
    retry: BELTCON_QUERY_RETRY.read,
  });
}

export const useBagLifecycleReport = hook("bag-lifecycle", reportKeys.bagLifecycle);
export const useTaggingReport = hook("tagging", reportKeys.tagging);
export const useRfidActivityReport = hook("rfid", reportKeys.rfid);
export const useAlarmReport = hook("alarms", reportKeys.alarms);
export const useRecheckReport = hook("recheck", reportKeys.recheck);
export const useReaderHealthReport = hook("readers", reportKeys.readers);
export const useIntegrationReport = hook("integrations", reportKeys.integrations);
