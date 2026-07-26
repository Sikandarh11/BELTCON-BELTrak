import type { XrayScan } from "@/types/xray";

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

export async function getXrayForBag(bagId: string): Promise<XrayScan | null> {
  const response = await xrayRequest<{ scan: XrayScan | null }>(
    `/api/xray/bags/${encodeURIComponent(bagId)}`,
  );
  return response.scan;
}

export async function refreshXrayForBag(bagId: string): Promise<XrayScan> {
  const response = await xrayRequest<{ scan: XrayScan }>(
    `/api/xray/bags/${encodeURIComponent(bagId)}/refresh`,
    { method: "POST" },
  );
  return response.scan;
}
