import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { auditKeys, readerKeys, reportKeys, rfidKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_RETRY, BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import { readApiResponse } from "@/services/api/appApiError";

import type {
  ReaderDetail,
  ReaderListFilters,
  ReaderListResponse,
  ReaderSummary,
  UpdateAntennaInput,
  UpdateReaderInput,
} from "./readerSchemas";

function queryString(filters: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export async function fetchReaders(filters: ReaderListFilters): Promise<ReaderListResponse> {
  return readApiResponse<ReaderListResponse>(
    await fetch(`/api/readers${queryString(filters)}`, { credentials: "include" }),
    "Unable to load reader inventory",
  );
}

export async function fetchReader(readerId: string): Promise<ReaderDetail> {
  const response = await readApiResponse<{ reader: ReaderDetail }>(
    await fetch(`/api/readers/${encodeURIComponent(readerId)}`, { credentials: "include" }),
    "Unable to load reader",
  );
  return response.reader;
}

async function patch<T>(url: string, input: unknown, fallback: string): Promise<T> {
  return readApiResponse<T>(
    await fetch(url, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    fallback,
  );
}

export function useReaders(filters: ReaderListFilters) {
  return useQuery({
    queryKey: readerKeys.list(filters),
    queryFn: () => fetchReaders(filters),
    staleTime: BELTCON_QUERY_STALE_TIME.readerConfiguration,
    retry: BELTCON_QUERY_RETRY.read,
  });
}

export function useReader(readerId: string | null) {
  return useQuery({
    queryKey: readerKeys.detail(readerId ?? "none"),
    queryFn: () => fetchReader(readerId!),
    enabled: Boolean(readerId),
    staleTime: BELTCON_QUERY_STALE_TIME.readerConfiguration,
    retry: BELTCON_QUERY_RETRY.read,
  });
}

export function useUpdateReader() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ readerId, input }: { readerId: string; input: UpdateReaderInput }) => {
      const result = await patch<{ reader: ReaderSummary }>(
        `/api/readers/${encodeURIComponent(readerId)}`,
        input,
        "Unable to update reader configuration",
      );
      return result.reader;
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: readerKeys.all }),
        queryClient.invalidateQueries({ queryKey: readerKeys.detail(variables.readerId) }),
        queryClient.invalidateQueries({ queryKey: readerKeys.antennaMap() }),
        queryClient.invalidateQueries({ queryKey: rfidKeys.events() }),
        queryClient.invalidateQueries({ queryKey: reportKeys.readers({}) }),
        queryClient.invalidateQueries({ queryKey: auditKeys.all }),
      ]);
    },
  });
}

export function useUpdateAntenna() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      readerId,
      antennaId,
      input,
    }: {
      readerId: string;
      antennaId: string;
      input: UpdateAntennaInput;
    }) => {
      const result = await patch<{ antenna: ReaderDetail["antennas"][number] }>(
        `/api/readers/${encodeURIComponent(readerId)}/antennas/${encodeURIComponent(antennaId)}`,
        input,
        "Unable to update antenna configuration",
      );
      return result.antenna;
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: readerKeys.detail(variables.readerId) }),
        queryClient.invalidateQueries({ queryKey: readerKeys.antennaMap() }),
        queryClient.invalidateQueries({ queryKey: rfidKeys.events() }),
        queryClient.invalidateQueries({ queryKey: reportKeys.readers({}) }),
        queryClient.invalidateQueries({ queryKey: auditKeys.all }),
      ]);
    },
  });
}
