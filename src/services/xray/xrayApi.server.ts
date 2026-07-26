import "@tanstack/react-start/server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { parseHbssIngestionPayload } from "@/services/integrations/hbss/hbssSchemas";
import { getSessionFromRequest } from "@/services/authRepository.server";
import { roleIsAtLeast } from "@/services/roles";
import type { XrayService } from "./xrayService.server";
import { XrayServiceError } from "./xrayErrors";
import { xrayService } from "./xrayService.server";

const MAX_INGESTION_BODY_BYTES = 256 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;

interface AuthenticatedHandlerOptions {
  service?: XrayService;
  getSession?: SessionLookup;
}

interface IngestionHandlerOptions {
  service?: Pick<XrayService, "ingestScan">;
  integrationKey?: string | null;
}

interface HealthHandlerOptions {
  service?: Pick<XrayService, "getAdapterHealth">;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function errorResponse(error: unknown) {
  if (error instanceof XrayServiceError) {
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
      },
      error.status,
    );
  }

  return jsonResponse(
    {
      error: "X-ray service request failed",
      code: "XRAY_INTERNAL_ERROR",
    },
    500,
  );
}

async function authorize(
  request: Request,
  getSession: SessionLookup,
  minimumCanonicalRole?: string,
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await getSession(request);
  } catch {
    return {
      response: jsonResponse({ error: "Authentication check failed" }, 500),
      session: null,
    };
  }

  if (!session) {
    return {
      response: jsonResponse({ error: "Unauthorized" }, 401),
      session: null,
    };
  }

  if (minimumCanonicalRole && !roleIsAtLeast(session.user.role, minimumCanonicalRole)) {
    return {
      response: jsonResponse({ error: "Forbidden" }, 403),
      session: null,
    };
  }

  return { response: null, session };
}

function integrationKeysMatch(provided: string, configured: string) {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new Response(null, { status: 415 });
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_INGESTION_BODY_BYTES) {
      throw new Response(null, { status: 413 });
    }
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_INGESTION_BODY_BYTES) {
    throw new Response(null, { status: 413 });
  }

  if (!body.trim()) {
    throw new SyntaxError("Empty JSON body");
  }

  return JSON.parse(body) as unknown;
}

export async function handleGetBagXrayRequest(
  request: Request,
  bagId: string,
  options: AuthenticatedHandlerOptions = {},
) {
  const authorization = await authorize(request, options.getSession ?? getSessionFromRequest);
  if (authorization.response) {
    return authorization.response;
  }

  try {
    const scan = await (options.service ?? xrayService).getScanForBag(bagId);
    return jsonResponse({ scan });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleRefreshBagXrayRequest(
  request: Request,
  bagId: string,
  options: AuthenticatedHandlerOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "Operations Officer",
  );
  if (authorization.response) {
    return authorization.response;
  }

  try {
    const scan = await (options.service ?? xrayService).refreshScanForBag(bagId);
    return jsonResponse({ scan });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleHbssIngestionRequest(
  request: Request,
  options: IngestionHandlerOptions = {},
) {
  const configuredKey =
    options.integrationKey === undefined
      ? (process.env.HBSS_INTEGRATION_KEY ?? null)
      : options.integrationKey;

  if (!configuredKey) {
    return jsonResponse(
      {
        error: "HBSS ingestion is not configured",
        code: "HBSS_INTEGRATION_NOT_CONFIGURED",
      },
      503,
    );
  }

  const suppliedKey = request.headers.get("x-hbss-integration-key");
  if (!suppliedKey || !integrationKeysMatch(suppliedKey, configuredKey)) {
    return jsonResponse(
      {
        error: "Missing or invalid integration key",
        code: "HBSS_INTEGRATION_UNAUTHORIZED",
      },
      401,
    );
  }

  let untrustedPayload: unknown;
  try {
    untrustedPayload = await readLimitedJson(request);
  } catch (error) {
    if (error instanceof Response && error.status === 413) {
      return jsonResponse(
        {
          error: "Request body is too large",
          code: "HBSS_PAYLOAD_TOO_LARGE",
        },
        413,
      );
    }

    if (error instanceof Response && error.status === 415) {
      return jsonResponse(
        {
          error: "Content-Type must be application/json",
          code: "HBSS_CONTENT_TYPE_UNSUPPORTED",
        },
        415,
      );
    }

    return jsonResponse(
      {
        error: "Request body must contain valid JSON",
        code: "HBSS_JSON_INVALID",
      },
      400,
    );
  }

  let payload;
  try {
    payload = parseHbssIngestionPayload(untrustedPayload);
  } catch {
    return jsonResponse(
      {
        error: "Invalid HBSS ingestion payload",
        code: "HBSS_PAYLOAD_INVALID",
      },
      400,
    );
  }

  try {
    const scan = await (options.service ?? xrayService).ingestScan(payload);
    return jsonResponse({ scan }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleHbssHealthRequest(options: HealthHandlerOptions = {}) {
  try {
    const health = await (options.service ?? xrayService).getAdapterHealth();
    return jsonResponse(health, health.healthy ? 200 : 503);
  } catch {
    return jsonResponse(
      {
        adapter: "unknown",
        healthy: false,
        message: "HBSS adapter health check failed",
      },
      503,
    );
  }
}
