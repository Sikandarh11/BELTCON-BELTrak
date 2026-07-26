import type { EncodeTagResponse, PendingTaggingResponse, TaggingBag } from "@/types/tagging";

export const PENDING_TAGGING_QUERY_KEY = ["bags", "pending-tagging"] as const;

export class TaggingApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "TaggingApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // The status code remains authoritative if a proxy returned no JSON body.
  }

  if (!response.ok) {
    throw new TaggingApiError(
      typeof body.error === "string" ? body.error : "Tagging request failed",
      response.status,
      typeof body.code === "string" ? body.code : undefined,
    );
  }

  return body as T;
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
