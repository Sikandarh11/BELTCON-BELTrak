import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { recordAccessDenied } from "@/services/securityAudit.server";

import { ReaderApiError } from "./readerErrors";
import { readerService, type ReaderService } from "./readerService.server";
import {
  createReaderConfigurationSchema,
  readerListFiltersSchema,
  setReaderEnabledSchema,
  updateAntennaSchema,
  updateReaderConfigurationSchema,
} from "./readerSchemas";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
const MAX_BODY_BYTES = 8 * 1024;
type SessionLookup = typeof getSessionFromRequest;

function getSiteId() {
  return process.env.SBTS_SITE_ID?.trim() || process.env.BHS_STATION_SITE_ID?.trim() || "ALWAJH";
}

export interface ReaderApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  service?: ReaderService;
  recordAccessDenied?: typeof recordAccessDenied;
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function requestIdFor(request: Request) {
  const candidate = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

async function authorize(
  request: Request,
  permission: "reader.view" | "reader.manage",
  options: ReaderApiOptions,
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return {
      response: respond(
        { error: "Unable to verify the authenticated session", code: "READER_QUERY_FAILED" },
        500,
      ),
      session: null,
    };
  }
  if (!session) {
    return {
      response: respond(
        { error: "An authenticated session is required", code: "READER_UNAUTHORIZED" },
        401,
      ),
      session: null,
    };
  }
  try {
    await (options.requirePermission ?? requirePermission)(session, permission);
    return { response: null, session };
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    if (status === 403) {
      try {
        await (options.recordAccessDenied ?? recordAccessDenied)({
          actorId: session.user.id,
          canonicalRole: session.user.role,
          requiredPermission: permission,
          resource: new URL(request.url).pathname,
          method: request.method,
          requestId: requestIdFor(request),
        });
      } catch {
        // Audit unavailability must not change the authorization outcome.
      }
    }
    return {
      response: respond(
        {
          error:
            status === 403 ? `Permission ${permission} is required` : "Permission check failed",
          code: "READER_UNAUTHORIZED",
        },
        status,
      ),
      session: null,
    };
  }
}

async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new ReaderApiError(
      "Content-Type must be application/json",
      "READER_INVALID_CONFIGURATION",
      415,
    );
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ReaderApiError("Request body is too large", "READER_INVALID_CONFIGURATION", 413);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw new ReaderApiError("Request body is too large", "READER_INVALID_CONFIGURATION", 413);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ReaderApiError("Invalid JSON request body", "READER_INVALID_CONFIGURATION", 400);
  }
}

function queryFilters(request: Request) {
  const query = new URL(request.url).searchParams;
  return readerListFiltersSchema.safeParse({
    page: query.get("page") ?? undefined,
    pageSize: query.get("pageSize") ?? undefined,
    search: query.get("search") ?? undefined,
    status: query.get("status") ?? undefined,
    enabled: query.get("enabled") ?? undefined,
    zone: query.get("zone") ?? undefined,
    sort: query.get("sort") ?? undefined,
    direction: query.get("direction") ?? undefined,
  });
}

function safeError(error: unknown) {
  if (error instanceof ReaderApiError)
    return respond({ error: error.message, code: error.code }, error.status);
  const message = error instanceof Error ? error.message : "";
  if (
    (error as { code?: string } | null)?.code === "23505" ||
    /already exists|duplicate/i.test(message)
  )
    return respond(
      { error: "Reader code already exists for this site", code: "READER_CONFLICT" },
      409,
    );
  if (/version conflict/i.test(message))
    return respond(
      { error: "This reader was changed by another user", code: "READER_VERSION_CONFLICT" },
      409,
    );
  if (/not found/i.test(message))
    return respond({ error: "Reader or antenna was not found", code: "READER_NOT_FOUND" }, 404);
  return respond({ error: "Reader request failed", code: "READER_QUERY_FAILED" }, 500);
}

export async function handleListReadersRequest(request: Request, options: ReaderApiOptions = {}) {
  const authorization = await authorize(request, "reader.view", options);
  if (authorization.response) return authorization.response;
  const filters = queryFilters(request);
  if (!filters.success) {
    return respond(
      {
        error: filters.error.issues[0]?.message ?? "Invalid reader filters",
        code: "READER_INVALID_CONFIGURATION",
      },
      400,
    );
  }
  try {
    return respond(
      await (options.service ?? readerService).listReadersForSite(getSiteId(), filters.data),
    );
  } catch (error) {
    return safeError(error);
  }
}

export async function handleGetReaderRequest(
  request: Request,
  readerId: string,
  options: ReaderApiOptions = {},
) {
  const authorization = await authorize(request, "reader.view", options);
  if (authorization.response) return authorization.response;
  if (!readerId.trim())
    return respond({ error: "A reader ID is required", code: "READER_NOT_FOUND" }, 400);
  try {
    const reader = await (options.service ?? readerService).getReaderById(getSiteId(), readerId);
    return reader
      ? respond({ reader })
      : respond({ error: "Reader was not found", code: "READER_NOT_FOUND" }, 404);
  } catch (error) {
    return safeError(error);
  }
}

export async function handleCreateReaderRequest(request: Request, options: ReaderApiOptions = {}) {
  const authorization = await authorize(request, "reader.manage", options);
  if (authorization.response || !authorization.session) return authorization.response!;
  try {
    const parsed = createReaderConfigurationSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      await recordRejected(
        options,
        authorization.session,
        "NEW",
        request,
        "READER_INVALID_CONFIGURATION",
      );
      return respond(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid reader configuration",
          code: "READER_INVALID_CONFIGURATION",
        },
        400,
      );
    }
    const reader = await (options.service ?? readerService).createReaderConfiguration({
      ...parsed.data,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
    });
    return respond({ reader }, 201);
  } catch (error) {
    await recordRejected(
      options,
      authorization.session,
      "NEW",
      request,
      error instanceof ReaderApiError ? error.code : "READER_QUERY_FAILED",
    );
    return safeError(error);
  }
}
async function recordRejected(
  options: ReaderApiOptions,
  session: NonNullable<Awaited<ReturnType<SessionLookup>>>,
  readerId: string,
  request: Request,
  code: string,
  antennaId?: string,
) {
  try {
    await (options.service ?? readerService).recordRejected({
      actorId: session.user.id,
      canonicalRole: session.user.role,
      readerId,
      ...(antennaId ? { antennaId } : {}),
      requestId: requestIdFor(request),
      code,
    });
  } catch {
    // The request still returns its safe original error.
  }
}

export async function handleUpdateReaderRequest(
  request: Request,
  readerId: string,
  options: ReaderApiOptions = {},
) {
  const authorization = await authorize(request, "reader.manage", options);
  if (authorization.response || !authorization.session) return authorization.response!;
  try {
    const parsed = updateReaderConfigurationSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      await recordRejected(
        options,
        authorization.session,
        readerId,
        request,
        "READER_INVALID_CONFIGURATION",
      );
      return respond(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid reader configuration",
          code: "READER_INVALID_CONFIGURATION",
        },
        400,
      );
    }
    const reader = await (options.service ?? readerService).updateReader({
      ...parsed.data,
      readerId,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
    });
    return respond({ reader });
  } catch (error) {
    await recordRejected(
      options,
      authorization.session,
      readerId,
      request,
      error instanceof ReaderApiError ? error.code : "READER_QUERY_FAILED",
    );
    return safeError(error);
  }
}

export async function handleSetReaderEnabledRequest(
  request: Request,
  readerId: string,
  options: ReaderApiOptions = {},
) {
  const authorization = await authorize(request, "reader.manage", options);
  if (authorization.response || !authorization.session) return authorization.response!;
  try {
    const parsed = setReaderEnabledSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      await recordRejected(
        options,
        authorization.session,
        readerId,
        request,
        "READER_INVALID_CONFIGURATION",
      );
      return respond(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid reader enabled request",
          code: "READER_INVALID_CONFIGURATION",
        },
        400,
      );
    }
    const reader = await (options.service ?? readerService).setReaderEnabled({
      ...parsed.data,
      readerId,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
    });
    return respond({ reader });
  } catch (error) {
    await recordRejected(
      options,
      authorization.session,
      readerId,
      request,
      error instanceof ReaderApiError ? error.code : "READER_QUERY_FAILED",
    );
    return safeError(error);
  }
}
export async function handleUpdateAntennaRequest(
  request: Request,
  readerId: string,
  antennaId: string,
  options: ReaderApiOptions = {},
) {
  const authorization = await authorize(request, "reader.manage", options);
  if (authorization.response || !authorization.session) return authorization.response!;
  try {
    const parsed = updateAntennaSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      await recordRejected(
        options,
        authorization.session,
        readerId,
        request,
        "ANTENNA_INVALID_ZONE",
        antennaId,
      );
      return respond(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid antenna configuration",
          code: "ANTENNA_INVALID_ZONE",
        },
        400,
      );
    }
    const antenna = await (options.service ?? readerService).updateAntenna({
      ...parsed.data,
      readerId,
      antennaId,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
    });
    return respond({ antenna });
  } catch (error) {
    await recordRejected(
      options,
      authorization.session,
      readerId,
      request,
      error instanceof ReaderApiError ? error.code : "READER_QUERY_FAILED",
      antennaId,
    );
    return safeError(error);
  }
}
