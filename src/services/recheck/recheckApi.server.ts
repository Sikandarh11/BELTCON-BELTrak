import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import type { PermissionCode } from "@/services/admin/roles/roleSchemas";
import { RecheckServiceError } from "./recheckErrors";
import { recheckService, type RecheckService } from "./recheckService.server";
import {
  hbssRecallSchema,
  recheckQueueFilterSchema,
  recheckTagSchema,
  resolveRecheckSchema,
} from "./recheckSchemas";
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
type SessionLookup = typeof getSessionFromRequest;
export interface RecheckApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  service?: RecheckService;
}
async function authorize(
  request: Request,
  options: RecheckApiOptions,
  permission: PermissionCode = "bag.recheck",
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return {
      response: json(
        { error: "Unable to verify the authenticated session", code: "RECHECK_PROCESSING_FAILED" },
        500,
      ),
      session: null,
    };
  }
  if (!session)
    return {
      response: json(
        { error: "An authenticated session is required", code: "RECHECK_UNAUTHENTICATED" },
        401,
      ),
      session: null,
    };
  try {
    await (options.requirePermission ?? requirePermission)(session, permission);
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return {
      response: json(
        {
          error:
            status === 403 ? `Permission ${permission} is required` : "Permission check failed",
          code: status === 403 ? "RECHECK_UNAUTHORIZED" : "RECHECK_PROCESSING_FAILED",
        },
        status,
      ),
      session: null,
    };
  }
  return { response: null, session };
}
async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new RecheckServiceError(
      "Content-Type must be application/json",
      "RECHECK_VALIDATION_ERROR",
      415,
    );
  const raw = await request.text();
  if (raw.length > 8192)
    throw new RecheckServiceError("Request body is too large", "RECHECK_VALIDATION_ERROR", 413);
  return JSON.parse(raw) as unknown;
}
const error = (value: unknown) =>
  value instanceof RecheckServiceError
    ? json({ error: value.message, code: value.code }, value.status)
    : json({ error: "Recheck request failed", code: "RECHECK_PROCESSING_FAILED" }, 500);
export async function handleRecheckQueue(request: Request, options: RecheckApiOptions = {}) {
  const auth = await authorize(request, options);
  if (auth.response) return auth.response;
  const q = new URL(request.url).searchParams;
  const parsed = recheckQueueFilterSchema.safeParse({
    page: q.get("page") ? Number(q.get("page")) : undefined,
    pageSize: q.get("pageSize") ? Number(q.get("pageSize")) : undefined,
    search: q.get("search") ?? undefined,
    alarmStatus: q.get("alarmStatus") ?? undefined,
    stationId: q.get("stationId") ?? undefined,
  });
  if (!parsed.success)
    return json({ error: "Invalid Recheck queue filters", code: "RECHECK_VALIDATION_ERROR" }, 400);
  try {
    return json(await (options.service ?? recheckService).queue(parsed.data));
  } catch (e) {
    return error(e);
  }
}
export async function handleRecheckTag(
  request: Request,
  tag: string,
  options: RecheckApiOptions = {},
) {
  const auth = await authorize(request, options);
  if (auth.response) return auth.response;
  const parsed = recheckTagSchema.safeParse(tag);
  if (!parsed.success)
    return json(
      { error: "A valid RFID label barcode or EPC is required", code: "RECHECK_TAG_REQUIRED" },
      400,
    );
  try {
    return json({ case: await (options.service ?? recheckService).caseByTag(parsed.data) });
  } catch (e) {
    return error(e);
  }
}
export async function handleRecheckCase(
  request: Request,
  bagId: string,
  options: RecheckApiOptions = {},
) {
  const auth = await authorize(request, options);
  if (auth.response) return auth.response;
  try {
    return json({ case: await (options.service ?? recheckService).caseByBag(bagId) });
  } catch (e) {
    return error(e);
  }
}
export async function handleRecall(
  request: Request,
  bagId: string,
  options: RecheckApiOptions = {},
) {
  const auth = await authorize(request, options);
  if (auth.response || !auth.session) return auth.response;
  try {
    const parsed = hbssRecallSchema.safeParse(await body(request));
    if (!parsed.success)
      return json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid HBSS recall",
          code: "RECHECK_VALIDATION_ERROR",
        },
        400,
      );
    return json(
      await (options.service ?? recheckService).recall({
        ...parsed.data,
        bagId,
        actorId: auth.session.user.id,
        canonicalRole: auth.session.user.role,
        requestId: request.headers.get("x-request-id") ?? randomUUID(),
      }),
    );
  } catch (e) {
    return error(e);
  }
}
export async function handleResolve(
  request: Request,
  bagId: string,
  options: RecheckApiOptions = {},
) {
  const auth = await authorize(request, options, "bag.resolve");
  if (auth.response || !auth.session) return auth.response;
  try {
    const parsed = resolveRecheckSchema.safeParse(await body(request));
    if (!parsed.success)
      return json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid final resolution",
          code: "RECHECK_VALIDATION_ERROR",
        },
        400,
      );
    return json(
      await (options.service ?? recheckService).resolve({
        ...parsed.data,
        bagId,
        actorId: auth.session.user.id,
        canonicalRole: auth.session.user.role,
        requestId: request.headers.get("x-request-id") ?? randomUUID(),
      }),
    );
  } catch (e) {
    return error(e);
  }
}
