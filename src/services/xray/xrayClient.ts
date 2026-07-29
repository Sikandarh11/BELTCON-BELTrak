import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { auditKeys, hbssKeys, recheckKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import type { XrayScanSelection } from "@/types/xray";

export interface HbssHealth {
  adapter: string;
  healthy: boolean;
  status: "CONNECTED" | "SIMULATED" | "UNAVAILABLE";
  lastChecked: string;
  message: string;
}

export class XrayApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "XrayApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseApiError(response: Response) {
  const fallback =
    response.status === 401
      ? "Please sign in to continue"
      : response.status === 403
        ? "You do not have access to refresh this X-ray scan"
        : "X-ray request failed";

  try {
    const body = (await response.json()) as {
      error?: string;
      code?: string;
    };
    return new XrayApiError(body.error ?? fallback, response.status, body.code);
  } catch {
    return new XrayApiError(fallback, response.status);
  }
}

async function xrayRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new XrayApiError("The X-ray service returned an invalid response", 502);
  }
}

function viewSessionHeaders(viewSessionId?: string) {
  return viewSessionId ? { "x-xray-view-session-id": viewSessionId } : undefined;
}

export async function getXrayForBag(
  bagId: string,
  viewSessionId?: string,
): Promise<XrayScanSelection> {
  return xrayRequest<XrayScanSelection>(`/api/xray/bags/${encodeURIComponent(bagId)}`, {
    headers: viewSessionHeaders(viewSessionId),
  });
}

export async function refreshXrayForBag(
  bagId: string,
  viewSessionId?: string,
): Promise<XrayScanSelection> {
  return xrayRequest<XrayScanSelection>(`/api/xray/bags/${encodeURIComponent(bagId)}/refresh`, {
    method: "POST",
    headers: viewSessionHeaders(viewSessionId),
  });
}

export async function getHbssHealth(): Promise<HbssHealth> {
  const response = await fetch("/api/integrations/hbss/health", {
    credentials: "include",
    headers: { accept: "application/json" },
  });

  const body = (await response.json()) as Partial<HbssHealth>;
  if (
    typeof body.adapter !== "string" ||
    typeof body.healthy !== "boolean" ||
    !["CONNECTED", "SIMULATED", "UNAVAILABLE"].includes(body.status ?? "") ||
    typeof body.lastChecked !== "string" ||
    typeof body.message !== "string"
  ) {
    throw new XrayApiError("The HBSS health service returned an invalid response", 502);
  }

  return body as HbssHealth;
}

export function useXrayForBag(bagId: string | null, viewSessionId: string | undefined) {
  return useQuery({
    queryKey: hbssKeys.xraySelection(bagId ?? ""),
    queryFn: () => getXrayForBag(bagId ?? "", viewSessionId),
    enabled: Boolean(bagId),
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
  });
}

export function useRefreshXrayForBag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bagId, viewSessionId }: { bagId: string; viewSessionId: string }) =>
      refreshXrayForBag(bagId, viewSessionId),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hbssKeys.xraySelection(variables.bagId) }),
        queryClient.invalidateQueries({ queryKey: recheckKeys.caseByBag(variables.bagId) }),
        queryClient.invalidateQueries({ queryKey: auditKeys.all }),
      ]);
    },
  });
}
