import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { recordAccessDenied } from "@/services/securityAudit.server";

import {
  operationalReportService,
  type OperationalReportService,
} from "./operationalReportService.server";
import { reportFiltersSchema, type OperationalReport, type ReportType } from "./reportSchemas";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
type SessionLookup = typeof getSessionFromRequest;

export interface OperationalReportApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  service?: OperationalReportService;
  recordAccessDenied?: typeof recordAccessDenied;
}

function requestIdFor(request: Request) {
  const candidate = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}
const respond = (body: unknown, status = 200, headers: HeadersInit = JSON_HEADERS) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

async function authorize(request: Request, options: OperationalReportApiOptions) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return {
      response: respond(
        { error: "Unable to verify the authenticated session", code: "REPORT_QUERY_FAILED" },
        500,
      ),
      session: null,
    };
  }
  if (!session)
    return {
      response: respond(
        { error: "An authenticated session is required", code: "REPORT_UNAUTHORIZED" },
        401,
      ),
      session: null,
    };
  try {
    await (options.requirePermission ?? requirePermission)(session, "report.view");
    return { response: null, session };
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    if (status === 403) {
      try {
        await (options.recordAccessDenied ?? recordAccessDenied)({
          actorId: session.user.id,
          canonicalRole: session.user.role,
          requiredPermission: "report.view",
          resource: new URL(request.url).pathname,
          method: request.method,
          requestId: requestIdFor(request),
        });
      } catch {
        // A durable denial audit must never grant report access.
      }
    }
    return {
      response: respond(
        {
          error: status === 403 ? "Permission report.view is required" : "Permission check failed",
          code: "REPORT_UNAUTHORIZED",
        },
        status,
      ),
      session: null,
    };
  }
}

function filtersFor(request: Request) {
  const search = new URL(request.url).searchParams;
  return reportFiltersSchema.safeParse({
    dateFrom: search.get("dateFrom") ?? undefined,
    dateTo: search.get("dateTo") ?? undefined,
    bhsLineId: search.get("bhsLineId") ?? undefined,
    screeningEvaluation: search.get("screeningEvaluation") ?? undefined,
    bagStatus: search.get("bagStatus") ?? undefined,
    zone: search.get("zone") ?? undefined,
    readerId: search.get("readerId") ?? undefined,
    alarmStatus: search.get("alarmStatus") ?? undefined,
    alarmSeverity: search.get("alarmSeverity") ?? undefined,
    resolutionDisposition: search.get("resolutionDisposition") ?? undefined,
    integrationSource: search.get("integrationSource") ?? undefined,
  });
}

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function reportCsv(report: OperationalReport) {
  const rows: Array<Array<string | number | null>> = [
    ["Section", "Field", "Value"],
    ["Metadata", "Report type", report.reportType],
    ["Metadata", "Generated at", report.generatedAt],
    ...Object.entries(report.filters).map(([field, value]) => ["Filter", field, value ?? ""]),
    ...Object.entries(report.summary).map(([metric, value]) => ["Summary", metric, value]),
    ...Object.entries(report.breakdowns).flatMap(([name, breakdownRows]) =>
      breakdownRows.flatMap((breakdownRow, rowIndex) =>
        Object.entries(breakdownRow).map(([field, value]) => [
          `Breakdown: ${name}`,
          `${rowIndex + 1}.${field}`,
          value,
        ]),
      ),
    ),
  ];
  return `${rows.map((values) => values.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export async function handleOperationalReportRequest(
  request: Request,
  reportType: ReportType,
  options: OperationalReportApiOptions = {},
) {
  const authorization = await authorize(request, options);
  if (authorization.response) return authorization.response;
  const filters = filtersFor(request);
  if (!filters.success) {
    const rangeTooLarge = filters.error.issues.some((issue) => issue.message.includes("90 days"));
    return respond(
      {
        error: filters.error.issues[0]?.message ?? "Invalid report filters",
        code: rangeTooLarge ? "REPORT_RANGE_TOO_LARGE" : "REPORT_INVALID_FILTERS",
      },
      400,
    );
  }
  try {
    return respond(
      await (options.service ?? operationalReportService).generate(
        reportType,
        filters.data,
        requestIdFor(request),
      ),
    );
  } catch {
    return respond(
      { error: "Unable to generate the operational report", code: "REPORT_QUERY_FAILED" },
      500,
    );
  }
}

export async function handleOperationalReportExportRequest(
  request: Request,
  reportType: ReportType,
  options: OperationalReportApiOptions = {},
) {
  const authorization = await authorize(request, options);
  if (authorization.response) return authorization.response;
  const filters = filtersFor(request);
  if (!filters.success) {
    return respond(
      {
        error: filters.error.issues[0]?.message ?? "Invalid report filters",
        code: "REPORT_INVALID_FILTERS",
      },
      400,
    );
  }
  try {
    const report = await (options.service ?? operationalReportService).generate(
      reportType,
      filters.data,
      requestIdFor(request),
    );
    const stamp = report.generatedAt.slice(0, 10);
    return respond(reportCsv(report), 200, {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="beltcon-sbts-${reportType}-${stamp}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    });
  } catch {
    return respond(
      { error: "Unable to export the operational report", code: "REPORT_EXPORT_FAILED" },
      500,
    );
  }
}
