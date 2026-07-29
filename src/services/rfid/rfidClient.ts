import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReaderAntennaMap, RfidRead } from "./rfidReadSchemas";
import type { RfidReadResult } from "./rfidReadTypes";
import { alarmKeys, auditKeys, bagKeys, readerKeys, rfidKeys } from "@/lib/queryKeys";
import { BELTCON_QUERY_RETRY, BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import { readApiResponse } from "@/services/api/appApiError";

export const RFID_DOMAIN_QUERY_KEYS = {
  antennaMap: readerKeys.antennaMap(),
  events: rfidKeys.events(),
};
async function response<T>(res: Response): Promise<T> {
  return readApiResponse<T>(res, "RFID request failed");
}
export async function fetchReaderAntennaMap(): Promise<ReaderAntennaMap[]> {
  return (
    await response<{ mappings: ReaderAntennaMap[] }>(
      await fetch("/api/readers/antenna-map", { credentials: "include" }),
    )
  ).mappings;
}
export async function submitSimulatedRfidRead(
  input: RfidRead,
): Promise<{ requestId: string; result: RfidReadResult }> {
  return response(
    await fetch("/api/dev/simulator/rfid/reads", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
export function useReaderAntennaMap() {
  return useQuery({
    queryKey: RFID_DOMAIN_QUERY_KEYS.antennaMap,
    queryFn: fetchReaderAntennaMap,
    staleTime: BELTCON_QUERY_STALE_TIME.readerConfiguration,
    retry: BELTCON_QUERY_RETRY.read,
  });
}
export function useSubmitSimulatedRfidRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: submitSimulatedRfidRead,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: RFID_DOMAIN_QUERY_KEYS.events }),
        client.invalidateQueries({ queryKey: rfidKeys.trackableBags() }),
        client.invalidateQueries({ queryKey: bagKeys.all }),
        client.invalidateQueries({ queryKey: alarmKeys.all }),
        client.invalidateQueries({ queryKey: auditKeys.all }),
      ]);
    },
  });
}
