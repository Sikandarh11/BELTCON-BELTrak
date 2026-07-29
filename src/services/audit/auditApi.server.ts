import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { recordAccessDenied } from "@/services/securityAudit.server";

import { auditService, type AuditService } from "./auditService.server";
import { auditFiltersSchema, type AuditEventSummary } from "./auditSchemas";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
type SessionLookup = typeof getSessionFromRequest;
export interface AuditApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  service?: AuditService;
  recordAccessDenied?: typeof recordAccessDenied;
}
const respond = (body: unknown, status = 200, headers: HeadersInit = JSON_HEADERS) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
function requestIdFor(request: Request) {
  const candidate = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}
async function authorize(request: Request, options: AuditApiOptions) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return {
      response: respond(
        { error: "Unable to verify the authenticated session", code: "AUDIT_QUERY_FAILED" },
        500,
      ),
      session: null,
    };
  }
  if (!session)
    return {
      response: respond(
        { error: "An authenticated session is required", code: "AUDIT_UNAUTHORIZED" },
        401,
      ),
      session: null,
    };
  try {
    await (options.requirePermission ?? requirePermission)(session, "audit.view");
    return { response: null, session };
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    if (status === 403) {
      try {
        await (options.recordAccessDenied ?? recordAccessDenied)({
          actorId: session.user.id,
          canonicalRole: session.user.role,
          requiredPermission: "audit.view",
          resource: new URL(request.url).pathname,
          method: request.method,
          requestId: requestIdFor(request),
        });
      } catch {
        // A denial audit is not a path to report successful access.
      }
    }
    return {
      response: respond(
        {
          error: status === 403 ? "Permission audit.view is required" : "Permission check failed",
          code: "AUDIT_UNAUTHORIZED",
        },
        status,
      ),
      session: null,
    };
  }
}
function filtersFor(request: Request) {
  const query = new URL(request.url).searchParams;
  return auditFiltersSchema.safeParse({
    page: query.get("page") ?? undefined,
    pageSize: query.get("pageSize") ?? undefined,
    search: query.get("search") ?? undefined,
    action: query.get("action") ?? undefined,
    actorId: query.get("actorId") ?? undefined,
    targetType: query.get("targetType") ?? undefined,
    targetId: query.get("targetId") ?? undefined,
    outcome: query.get("outcome") ?? undefined,
    dateFrom: query.get("dateFrom") ?? undefined,
    dateTo: query.get("dateTo") ?? undefined,
    requestId: query.get("requestId") ?? undefined,
  });
}
function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
function csv(items: AuditEventSummary[]) {
  const header = [
    "Timestamp",
    "Action",
    "Actor",
    "Role",
    "Target Type",
    "Target ID",
    "Result",
    "Summary",
    "Request ID",
  ];
  const rows = items.map((item) => [
    item.createdAt,
    item.action,
    item.actorDisplayName ?? item.actorId,
    item.actorRole,
    item.targetType,
    item.targetId,
    item.outcome,
    item.summary,
    item.requestId,
  ]);
  return `${[header, ...rows].map((values) => values.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
export async function handleListAuditEventsRequest(
  request: Request,
  options: AuditApiOptions = {},
) {
  const authorization = await authorize(request, options);
  if (authorization.response) return authorization.response;
  const filters = filtersFor(request);
  if (!filters.success)
    return respond(
      {
        error: filters.error.issues[0]?.message ?? "Invalid audit filters",
        code: "AUDIT_INVALID_FILTERS",
      },
      400,
    );
  try {
    return respond(await (options.service ?? auditService).list(filters.data));
  } catch {
    return respond({ error: "Unable to load audit events", code: "AUDIT_QUERY_FAILED" }, 500);
  }
}
export async function handleGetAuditEventRequest(
  request: Request,
  auditId: string,
  options: AuditApiOptions = {},
) {
  const authorization = await authorize(request, options);
  if (authorization.response) return authorization.response;
  if (!auditId.trim())
    return respond({ error: "An audit event ID is required", code: "AUDIT_EVENT_NOT_FOUND" }, 400);
  try {
    const event = await (options.service ?? auditService).get(auditId);
    return event
      ? respond({ event })
      : respond({ error: "Audit event was not found", code: "AUDIT_EVENT_NOT_FOUND" }, 404);
  } catch {
    return respond({ error: "Unable to load audit event", code: "AUDIT_QUERY_FAILED" }, 500);
  }
}
export async function handleExportAuditEventsRequest(
  request: Request,
  options: AuditApiOptions = {},
) {
  const authorization = await authorize(request, options);
  if (authorization.response) return authorization.response;
  const filters = filtersFor(request);
  if (!filters.success)
    return respond(
      {
        error: filters.error.issues[0]?.message ?? "Invalid audit filters",
        code: "AUDIT_INVALID_FILTERS",
      },
      400,
    );
  try {
    const result = await (options.service ?? auditService).list({
      ...filters.data,
      page: 1,
      pageSize: 100,
    });
    return respond(csv(result.items), 200, {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="beltcon-sbts-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    });
  } catch {
    return respond({ error: "Unable to export audit events", code: "AUDIT_EXPORT_FAILED" }, 500);
  }
}
