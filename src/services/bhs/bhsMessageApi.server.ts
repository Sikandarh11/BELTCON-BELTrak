import "@tanstack/react-start/server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { BhsMessageError } from "./bhsMessageErrors";
import { bhsMessageService, type BhsMessageService } from "./bhsMessageService.server";

const MAX_BHS_MESSAGE_BODY_BYTES = 256 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

export interface BhsMessageApiOptions {
  service?: BhsMessageService;
  integrationKey?: string | null;
  sourceSystem?: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function credentialsMatch(provided: string, configured: string) {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  return supplied.length > 0 && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied)
    ? supplied
    : randomUUID();
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new BhsMessageError(
      "Content-Type must be application/json",
      "BHS_CONTENT_TYPE_UNSUPPORTED",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(length) && length > MAX_BHS_MESSAGE_BODY_BYTES) {
      throw new BhsMessageError("BHS message is too large", "BHS_MESSAGE_TOO_LARGE", 413);
    }
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BHS_MESSAGE_BODY_BYTES) {
    throw new BhsMessageError("BHS message is too large", "BHS_MESSAGE_TOO_LARGE", 413);
  }
  if (!body.trim()) throw new SyntaxError("Empty JSON body");
  return JSON.parse(body) as unknown;
}

function safeErrorResponse(error: unknown) {
  if (error instanceof BhsMessageError) {
    return jsonResponse({ error: error.message, code: error.code }, error.status);
  }
  return jsonResponse(
    { error: "BHS message processing failed", code: "BHS_PROCESSING_FAILED" },
    500,
  );
}

/** Equipment-only endpoint; a browser session, workspace mode, or flag is never sufficient. */
export async function handleBhsMessageRequest(
  request: Request,
  options: BhsMessageApiOptions = {},
) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed", code: "BHS_INVALID_MESSAGE" }, 405);
  }

  const configuredKey =
    options.integrationKey === undefined
      ? (process.env.BHS_INTEGRATION_KEY?.trim() ?? null)
      : options.integrationKey?.trim() || null;
  const configuredSource =
    options.sourceSystem === undefined
      ? (process.env.BHS_SOURCE_SYSTEM?.trim() ?? null)
      : options.sourceSystem?.trim() || null;

  if (!configuredKey || !configuredSource) {
    return jsonResponse(
      { error: "BHS integration is not configured", code: "BHS_INTEGRATION_UNAVAILABLE" },
      503,
    );
  }

  const suppliedKey = request.headers.get("x-bhs-integration-key");
  if (!suppliedKey) {
    return jsonResponse(
      { error: "BHS integration credentials are required", code: "BHS_AUTHENTICATION_REQUIRED" },
      401,
    );
  }
  if (!credentialsMatch(suppliedKey, configuredKey)) {
    return jsonResponse(
      { error: "BHS integration authentication failed", code: "BHS_AUTHENTICATION_FAILED" },
      401,
    );
  }

  let payload: unknown;
  try {
    payload = await readLimitedJson(request);
  } catch (error) {
    if (error instanceof BhsMessageError) return safeErrorResponse(error);
    return jsonResponse(
      { error: "Request body must contain valid JSON", code: "BHS_INVALID_MESSAGE" },
      400,
    );
  }

  const parsed = BhsBagMessageV1Schema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse({ error: "Invalid BHS message", code: "BHS_INVALID_MESSAGE" }, 400);
  }

  const requestId = requestIdFor(request);
  try {
    const result = await (options.service ?? bhsMessageService).ingestMessage(parsed.data, {
      sourceSystem: configuredSource,
      requestId,
    });
    const status = result.outcome === "REJECTED" ? 409 : result.outcome === "FAILED" ? 500 : 200;
    return jsonResponse({ requestId, result, acknowledgement: result.acknowledgement }, status);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
