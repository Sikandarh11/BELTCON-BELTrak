import "@tanstack/react-start/server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { BhsMessageError } from "./bhsMessageErrors";
import { bhsMessageService, type BhsMessageService } from "./bhsMessageService.server";

export const MAX_BHS_MESSAGE_BODY_BYTES = 256 * 1024;
const BHS_INGESTION_ENDPOINT = "/api/integrations/bhs/messages";
const integrationIdentityPattern = /^[A-Za-z0-9._:-]+$/;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

export interface BhsMessageApiOptions {
  service?: BhsMessageService;
  integrationKey?: string | null;
  sourceSystem?: string | null;
  siteId?: string | null;
  stationId?: string | null;
  requestSiteId?: string | null;
  requestStationId?: string | null;
  enabled?: boolean;
  endpointPath?: string;
}

export interface BhsIngressBinding {
  credential: string;
  sourceSystem: string;
  siteId: string;
  stationId: string | null;
  enabled: boolean;
  endpointPath: string;
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

export async function readLimitedBhsJson(request: Request): Promise<unknown> {
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

function resolveBhsIngressBinding(options: BhsMessageApiOptions): BhsIngressBinding | null {
  const credential =
    options.integrationKey === undefined
      ? process.env.BHS_INTEGRATION_KEY?.trim()
      : options.integrationKey?.trim();
  const sourceSystem =
    options.sourceSystem === undefined
      ? process.env.BHS_SOURCE_SYSTEM?.trim()
      : options.sourceSystem?.trim();
  const siteId =
    options.siteId === undefined ? process.env.BHS_SITE_ID?.trim() : options.siteId?.trim();
  const stationId =
    options.stationId === undefined
      ? process.env.BHS_STATION_ID?.trim() || null
      : options.stationId?.trim() || null;
  const enabled =
    options.enabled === undefined
      ? process.env.BHS_INTEGRATION_ENABLED?.trim().toLowerCase() === "true"
      : options.enabled;
  const endpointPath = options.endpointPath ?? BHS_INGESTION_ENDPOINT;

  if (
    !credential ||
    !sourceSystem ||
    !siteId ||
    !integrationIdentityPattern.test(sourceSystem) ||
    !integrationIdentityPattern.test(siteId) ||
    (stationId !== null && !integrationIdentityPattern.test(stationId)) ||
    endpointPath !== BHS_INGESTION_ENDPOINT
  ) {
    return null;
  }

  return { credential, sourceSystem, siteId, stationId, enabled, endpointPath };
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

  const binding = resolveBhsIngressBinding(options);
  if (!binding) {
    return jsonResponse(
      { error: "BHS integration is not configured", code: "BHS_INTEGRATION_UNAVAILABLE" },
      503,
    );
  }

  if (!binding.enabled) {
    return jsonResponse(
      { error: "BHS integration is unavailable", code: "BHS_INTEGRATION_UNAVAILABLE" },
      503,
    );
  }

  if (new URL(request.url).pathname !== binding.endpointPath) {
    return jsonResponse(
      {
        error: "BHS credential is not valid for this endpoint",
        code: "BHS_AUTHENTICATION_FAILED",
      },
      403,
    );
  }

  const requestSiteId =
    options.requestSiteId === undefined
      ? (process.env.SBTS_SITE_ID?.trim() ?? binding.siteId)
      : options.requestSiteId?.trim();
  if (!requestSiteId || requestSiteId !== binding.siteId) {
    return jsonResponse(
      { error: "BHS credential is not valid for this site", code: "BHS_AUTHENTICATION_FAILED" },
      403,
    );
  }

  const requestStationId =
    options.requestStationId === undefined
      ? request.headers.get("x-sbts-station-id")?.trim() || null
      : options.requestStationId?.trim() || null;
  if (binding.stationId && requestStationId !== binding.stationId) {
    return jsonResponse(
      {
        error: "BHS credential is not valid for this station",
        code: "BHS_AUTHENTICATION_FAILED",
      },
      403,
    );
  }

  const suppliedKey = request.headers.get("x-bhs-integration-key");
  if (!suppliedKey) {
    return jsonResponse(
      { error: "BHS integration credentials are required", code: "BHS_AUTHENTICATION_REQUIRED" },
      401,
    );
  }
  if (!credentialsMatch(suppliedKey, binding.credential)) {
    return jsonResponse(
      { error: "BHS integration authentication failed", code: "BHS_AUTHENTICATION_FAILED" },
      401,
    );
  }

  let payload: unknown;
  try {
    payload = await readLimitedBhsJson(request);
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
      sourceSystem: binding.sourceSystem,
      stationId: binding.stationId,
      siteId: binding.siteId,
      requestId,
    });
    const status = result.outcome === "REJECTED" ? 409 : result.outcome === "FAILED" ? 500 : 200;
    return jsonResponse({ requestId, result, acknowledgement: result.acknowledgement }, status);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
