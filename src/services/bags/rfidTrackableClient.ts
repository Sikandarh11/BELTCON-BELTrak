import { useQuery } from "@tanstack/react-query";
import { rfidKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_REFETCH_INTERVAL, BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import { AppApiError, readApiResponse } from "@/services/api/appApiError";
import type { RfidTrackableBagsResponse, RfidTrackableBag } from "@/types/rfid";

export const RFID_TRACKABLE_BAGS_QUERY_KEY = rfidKeys.trackableBags();

export class RfidTrackableBagsApiError extends AppApiError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, { code });
    this.name = "RfidTrackableBagsApiError";
  }
}

export async function fetchRfidTrackableBags(): Promise<RfidTrackableBag[]> {
  const response = await fetch("/api/bags/rfid-trackable", {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json",
    },
  });

  return (
    await readApiResponse<RfidTrackableBagsResponse>(response, "Unable to load RFID-trackable bags")
  ).bags;
}

export function useRfidTrackableBags() {
  return useQuery({
    queryKey: RFID_TRACKABLE_BAGS_QUERY_KEY,
    queryFn: fetchRfidTrackableBags,
    staleTime: BELTCON_QUERY_STALE_TIME.activeOperationalQueue,
    refetchInterval: BELTCON_QUERY_REFETCH_INTERVAL.activeOperationalQueue,
    refetchOnWindowFocus: true,
  });
}
