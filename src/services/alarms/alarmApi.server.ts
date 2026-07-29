import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { recordAccessDenied, type AccessDeniedAuditInput } from "@/services/securityAudit.server";
import { AlarmServiceError } from "./alarmErrors";
import { alarmService, type AlarmService } from "./alarmService.server";
import {
  acknowledgeAlarmSchema,
  alarmListFilterSchema,
  escalateAlarmSchema,
  sendToRecheckSchema,
} from "./alarmSchemas";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
const MAX_BODY_BYTES = 8 * 1024;
type SessionLookup = typeof getSessionFromRequest;

export interface AlarmApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  service?: AlarmService;
  recordAccessDenied?: (input: AccessDeniedAuditInput) => Promise<void>;
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function requestIdFor(request: Request) {
  const value = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
}

async function authorize(
  request: Request,
  // audit.view remains documented here as legacy read-model compatibility;
  // new list/detail reads require the explicit alarm.read permission.
  permission: "alarm.read" | "audit.view" | "alarm.acknowledge" | "alarm.escalate" | "bag.recheck",
  options: AlarmApiOptions,
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return {
      response: respond(
        { error: "Unable to verify the authenticated session", code: "ALARM_PROCESSING_FAILED" },
        500,
      ),
      session: null,
    };
  }
  if (!session) {
    return {
      response: respond(
        { error: "An authenticated session is required", code: "ALARM_UNAUTHENTICATED" },
        401,
      ),
      session: null,
    };
  }
  try {
    await (options.requirePermission ?? requirePermission)(session, permission);
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    if (
      status === 403 &&
      (options.recordAccessDenied ?? (options.getSession ? undefined : recordAccessDenied))
    ) {
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
        // A denied response must not become a success when its audit insert is unavailable.
      }
    }
    return {
      response: respond(
        {
          error:
            status === 403 ? `Permission ${permission} is required` : "Permission check failed",
          code: status === 403 ? "ALARM_UNAUTHORIZED" : "ALARM_PROCESSING_FAILED",
        },
        status,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new AlarmServiceError(
      "Content-Type must be application/json",
      "ALARM_VALIDATION_ERROR",
      415,
    );
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new AlarmServiceError("Request body is too large", "ALARM_VALIDATION_ERROR", 413);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw new AlarmServiceError("Request body is too large", "ALARM_VALIDATION_ERROR", 413);
  }
  if (!body.trim()) throw new SyntaxError("Empty JSON body");
  return JSON.parse(body) as unknown;
}

function safeError(error: unknown) {
  if (error instanceof AlarmServiceError) {
    return respond({ error: error.message, code: error.code }, error.status);
  }
  return respond({ error: "Alarm request failed", code: "ALARM_PROCESSING_FAILED" }, 500);
}

function parseListFilters(request: Request) {
  const query = new URL(request.url).searchParams;
  const list = (name: string) =>
    (query.get(name) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  return alarmListFilterSchema.safeParse({
    page: query.get("page") ? Number(query.get("page")) : undefined,
    pageSize: query.get("pageSize") ? Number(query.get("pageSize")) : undefined,
    statuses: list("status"),
    severity: query.get("severity") ?? undefined,
    zone: query.get("zone") ?? undefined,
    search: query.get("search") ?? undefined,
    openedFrom: query.get("openedFrom") ?? undefined,
    openedTo: query.get("openedTo") ?? undefined,
    assignedTo: query.get("assignedTo") ?? undefined,
  });
}

export async function handleListAlarmsRequest(request: Request, options: AlarmApiOptions = {}) {
  const authorization = await authorize(request, "alarm.read", options);
  if (authorization.response) return authorization.response;
  const filters = parseListFilters(request);
  if (!filters.success) {
    return respond(
      {
        error: filters.error.issues[0]?.message ?? "Invalid alarm filters",
        code: "ALARM_VALIDATION_ERROR",
      },
      400,
    );
  }
  try {
    return respond(await (options.service ?? alarmService).list(filters.data));
  } catch (error) {
    return safeError(error);
  }
}

export async function handleGetAlarmRequest(
  request: Request,
  alarmId: string,
  options: AlarmApiOptions = {},
) {
  const authorization = await authorize(request, "alarm.read", options);
  if (authorization.response) return authorization.response;
  if (!alarmId.trim()) {
    return respond({ error: "A valid alarm ID is required", code: "ALARM_VALIDATION_ERROR" }, 400);
  }
  try {
    return respond({ alarm: await (options.service ?? alarmService).get(alarmId) });
  } catch (error) {
    return safeError(error);
  }
}

async function handleMutation(
  request: Request,
  alarmId: string,
  action: "acknowledge" | "escalate" | "sendToRecheck",
  options: AlarmApiOptions,
) {
  const permission =
    action === "acknowledge"
      ? "alarm.acknowledge"
      : action === "escalate"
        ? "alarm.escalate"
        : "bag.recheck";
  const authorization = await authorize(request, permission, options);
  if (authorization.response || !authorization.session) return authorization.response;
  if (!alarmId.trim()) {
    return respond({ error: "A valid alarm ID is required", code: "ALARM_VALIDATION_ERROR" }, 400);
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return safeError(
      error instanceof SyntaxError
        ? new AlarmServiceError("Request body must be valid JSON", "ALARM_VALIDATION_ERROR", 400)
        : error,
    );
  }
  const parsed =
    action === "acknowledge"
      ? acknowledgeAlarmSchema.safeParse(body)
      : action === "escalate"
        ? escalateAlarmSchema.safeParse(body)
        : sendToRecheckSchema.safeParse(body);
  if (!parsed.success) {
    return respond(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid alarm action",
        code: "ALARM_VALIDATION_ERROR",
      },
      400,
    );
  }
  const context = {
    alarmId,
    actorId: authorization.session.user.id,
    canonicalRole: authorization.session.user.role,
    requestId: requestIdFor(request),
  };
  try {
    const service = options.service ?? alarmService;
    let alarm;
    if (action === "acknowledge") {
      alarm = await service.acknowledge({
        ...acknowledgeAlarmSchema.parse(parsed.data),
        ...context,
      });
    } else if (action === "escalate") {
      alarm = await service.escalate({ ...escalateAlarmSchema.parse(parsed.data), ...context });
    } else {
      alarm = await service.sendToRecheck({
        ...sendToRecheckSchema.parse(parsed.data),
        ...context,
      });
    }
    return respond({ alarm });
  } catch (error) {
    return safeError(error);
  }
}

export const handleAcknowledgeAlarmRequest = (
  request: Request,
  alarmId: string,
  options: AlarmApiOptions = {},
) => handleMutation(request, alarmId, "acknowledge", options);

export const handleEscalateAlarmRequest = (
  request: Request,
  alarmId: string,
  options: AlarmApiOptions = {},
) => handleMutation(request, alarmId, "escalate", options);

export const handleSendToRecheckRequest = (
  request: Request,
  alarmId: string,
  options: AlarmApiOptions = {},
) => handleMutation(request, alarmId, "sendToRecheck", options);
