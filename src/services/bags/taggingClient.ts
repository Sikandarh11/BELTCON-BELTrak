import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auditKeys, bagKeys, rfidKeys, taggingKeys } from "@/lib/queryKeys";
import {
  BELTCON_QUERY_REFETCH_INTERVAL,
  BELTCON_QUERY_RETRY,
  BELTCON_QUERY_STALE_TIME,
} from "@/lib/queryPolicy";
import { AppApiError, readApiResponse } from "@/services/api/appApiError";

import type {
  AssignRfidTagRequest,
  AssignRfidTagResponse,
  EncodeTagResponse,
  PendingTaggingResponse,
  TaggingBag,
} from "@/types/tagging";

export const PENDING_TAGGING_QUERY_KEY = taggingKeys.queue();
export const TAGGING_DOMAIN_QUERY_KEYS = {
  pending: PENDING_TAGGING_QUERY_KEY,
  bag: taggingKeys.bag,
  audit: auditKeys.all,
} as const;

export class TaggingApiError extends AppApiError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, { code });
    this.name = "TaggingApiError";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  return readApiResponse<T>(response, "Tagging request failed");
}

export async function fetchPendingTagging(): Promise<TaggingBag[]> {
  const response = await fetch("/api/bags/pending-tagging", {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json",
    },
  });
  const body = await parseResponse<PendingTaggingResponse>(response);
  return body.bags;
}

export async function encodeBagTag(bagId: string, epc: string): Promise<TaggingBag> {
  const response = await fetch(`/api/bags/${encodeURIComponent(bagId)}/encode-tag`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ epc }),
  });
  const body = await parseResponse<EncodeTagResponse>(response);
  return body.bag;
}

export async function assignRfidTag(
  bagId: string,
  input: AssignRfidTagRequest,
): Promise<TaggingBag> {
  const response = await fetch(`/api/bags/${encodeURIComponent(bagId)}/assign-tag`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parseResponse<AssignRfidTagResponse>(response);
  return body.bag;
}

export function useTaggingQueue() {
  return useQuery({
    queryKey: TAGGING_DOMAIN_QUERY_KEYS.pending,
    queryFn: fetchPendingTagging,
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
    retry: BELTCON_QUERY_RETRY.read,
    refetchInterval: BELTCON_QUERY_REFETCH_INTERVAL.activeOperationalQueue,
    refetchOnWindowFocus: true,
  });
}

export function useAssignRfidTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bagId, input }: { bagId: string; input: AssignRfidTagRequest }) =>
      assignRfidTag(bagId, input),
    onSuccess: async (_bag, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TAGGING_DOMAIN_QUERY_KEYS.pending }),
        queryClient.invalidateQueries({ queryKey: TAGGING_DOMAIN_QUERY_KEYS.bag(variables.bagId) }),
        queryClient.invalidateQueries({ queryKey: bagKeys.all }),
        queryClient.invalidateQueries({ queryKey: TAGGING_DOMAIN_QUERY_KEYS.audit }),
        queryClient.invalidateQueries({ queryKey: rfidKeys.trackableBags() }),
      ]);
    },
  });
}
