import type { RfidTrackableBagsResponse, RfidTrackableBag } from "@/types/rfid";

export const RFID_TRACKABLE_BAGS_QUERY_KEY = ["bags", "rfid-trackable"] as const;

export class RfidTrackableBagsApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RfidTrackableBagsApiError";
    this.status = status;
    this.code = code;
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

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // The status code remains authoritative if a proxy returned no JSON body.
  }

  if (!response.ok) {
    throw new RfidTrackableBagsApiError(
      typeof body.error === "string" ? body.error : "Unable to load RFID-trackable bags",
      response.status,
      typeof body.code === "string" ? body.code : undefined,
    );
  }

  return (body as unknown as RfidTrackableBagsResponse).bags;
}
