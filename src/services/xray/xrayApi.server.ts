import "@tanstack/react-start/server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { roleIsAtLeast, type CanonicalRole } from "@/auth/canonicalRoles";
import { normalizeHbssIngestionPayload } from "@/services/integrations/hbss/hbssSchemas";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import type { PermissionCode } from "@/services/admin/roles/roleSchemas";
import type { XrayScan } from "@/types/xray";
import type { XrayService } from "./xrayService.server";
import { XrayServiceError } from "./xrayErrors";
import { xrayService } from "./xrayService.server";
import {
  xrayViewAuditRepository,
  type XrayViewAuditRepository,
} from "./xrayViewAuditRepository.server";

const MAX_INGESTION_BODY_BYTES = 256 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;

interface AuthenticatedHandlerOptions {
  service?: XrayService;
  getSession?: SessionLookup;
  viewAudit?: Pick<XrayViewAuditRepository, "recordViewed">;
  requirePermission?: typeof requirePermission;
}

interface IngestionHandlerOptions {
  service?: Pick<XrayService, "ingestScan">;
  integrationKey?: string | null;
  sourceSystem?: string | null;
  siteId?: string | null;
  enabled?: boolean;
  endpointPath?: string;
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
  options: AuthenticatedHandlerOptions,
  permission: PermissionCode,
  legacyMinimumRole: CanonicalRole,
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
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

  try {
    if (options.requirePermission) {
      await options.requirePermission(session, permission);
    } else if (options.getSession) {
      if (!roleIsAtLeast(session.user.role, legacyMinimumRole)) {
        throw new PermissionAuthorizationError("Permission denied", "PERMISSION_DENIED", 403);
      }
    } else {
      await requirePermission(session, permission);
    }
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return {
      response: jsonResponse(
        {
          error:
            status === 403 ? `Permission ${permission} is required` : "Permission check failed",
        },
        status,
      ),
      session: null,
    };
  }

  return { response: null, session };
}

function xrayViewRequestId(request: Request) {
  const supplied = request.headers.get("x-xray-view-session-id")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

async function auditAvailableScan(
  request: Request,
  session: NonNullable<Awaited<ReturnType<SessionLookup>>>,
  scan: XrayScan | null,
  repository: Pick<XrayViewAuditRepository, "recordViewed">,
) {
  if (!scan || scan.status !== "AVAILABLE" || scan.images.length === 0) {
    return;
  }

  await repository.recordViewed({
    userId: session.user.id,
    canonicalRole: session.user.role,
    bagId: scan.bagId ?? "",
    scanId: scan.id,
    sourceSystem: scan.sourceSystem,
    requestId: xrayViewRequestId(request),
    timestamp: new Date().toISOString(),
  });
}

function integrationKeysMatch(provided: string, configured: string) {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

const HBSS_INGESTION_ENDPOINT = "/api/integrations/hbss/scans";
const integrationIdentityPattern = /^[A-Za-z0-9._:-]+$/;

export interface HbssIngressBinding {
  credential: string;
  siteId: string;
  sourceSystem: string;
  endpointPath: string;
  enabled: boolean;
}

function resolveHbssIngressBinding(options: IngestionHandlerOptions): HbssIngressBinding | null {
  const credential =
    options.integrationKey === undefined
      ? process.env.HBSS_INTEGRATION_KEY?.trim()
      : options.integrationKey?.trim();
  const sourceSystem =
    options.sourceSystem === undefined
      ? process.env.HBSS_SOURCE_SYSTEM?.trim()
      : options.sourceSystem?.trim();
  const siteId =
    options.siteId === undefined ? process.env.HBSS_SITE_ID?.trim() : options.siteId?.trim();
  const enabled =
    options.enabled === undefined
      ? process.env.HBSS_INTEGRATION_ENABLED?.trim().toLowerCase() === "true"
      : options.enabled;
  const endpointPath = options.endpointPath ?? HBSS_INGESTION_ENDPOINT;

  if (
    !credential ||
    !sourceSystem ||
    !siteId ||
    !integrationIdentityPattern.test(sourceSystem) ||
    !integrationIdentityPattern.test(siteId) ||
    endpointPath !== HBSS_INGESTION_ENDPOINT
  ) {
    return null;
  }

  return { credential, siteId, sourceSystem, endpointPath, enabled };
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
  const authorization = await authorize(request, options, "xray.view", "Operations Officer");
  if (authorization.response) {
    return authorization.response;
  }

  try {
    const selection = await (options.service ?? xrayService).getScanSelectionForBag(bagId);
    await auditAvailableScan(
      request,
      authorization.session,
      selection.displayScan,
      options.viewAudit ?? xrayViewAuditRepository,
    );
    return jsonResponse(selection);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleRefreshBagXrayRequest(
  request: Request,
  bagId: string,
  options: AuthenticatedHandlerOptions = {},
) {
  const authorization = await authorize(request, options, "xray.refresh", "Operations Officer");
  if (authorization.response) {
    return authorization.response;
  }

  try {
    const service = options.service ?? xrayService;
    await service.refreshScanForBag(bagId, { signal: request.signal });
    const selection = await service.getScanSelectionForBag(bagId);
    await auditAvailableScan(
      request,
      authorization.session,
      selection.displayScan,
      options.viewAudit ?? xrayViewAuditRepository,
    );
    return jsonResponse(selection);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleHbssIngestionRequest(
  request: Request,
  options: IngestionHandlerOptions = {},
) {
  const binding = resolveHbssIngressBinding(options);

  if (!binding) {
    return jsonResponse(
      {
        error: "HBSS ingestion is not configured",
        code: "HBSS_INTEGRATION_NOT_CONFIGURED",
      },
      503,
    );
  }

  if (!binding.enabled) {
    return jsonResponse(
      { error: "HBSS ingestion is unavailable", code: "HBSS_INTEGRATION_DISABLED" },
      503,
    );
  }

  if (new URL(request.url).pathname !== binding.endpointPath) {
    return jsonResponse(
      {
        error: "HBSS credential is not valid for this endpoint",
        code: "HBSS_INTEGRATION_ENDPOINT_FORBIDDEN",
      },
      403,
    );
  }

  const suppliedKey = request.headers.get("x-hbss-integration-key");
  if (!suppliedKey || !integrationKeysMatch(suppliedKey, binding.credential)) {
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
    payload = normalizeHbssIngestionPayload(untrustedPayload, binding.sourceSystem, binding.siteId);
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
    const safeHealth = {
      adapter: health.adapter,
      healthy: health.healthy,
      status: health.status,
      lastChecked: health.lastChecked,
      message: health.message,
    };
    return jsonResponse(safeHealth, health.healthy ? 200 : 503);
  } catch {
    return jsonResponse(
      {
        adapter: "Unknown",
        healthy: false,
        status: "UNAVAILABLE",
        lastChecked: new Date().toISOString(),
        message: "HBSS adapter health check failed",
      },
      503,
    );
  }
}
