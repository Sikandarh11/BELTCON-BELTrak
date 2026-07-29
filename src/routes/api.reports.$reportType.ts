import { createFileRoute } from "@tanstack/react-router";

import { handleOperationalReportRequest } from "@/services/reports/operationalReportApi.server";
import { REPORT_TYPES, type ReportType } from "@/services/reports/reportSchemas";

export const Route = createFileRoute("/api/reports/$reportType")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        REPORT_TYPES.includes(params.reportType as ReportType)
          ? handleOperationalReportRequest(request, params.reportType as ReportType)
          : new Response(
              JSON.stringify({ error: "Unknown report type", code: "REPORT_INVALID_FILTERS" }),
              {
                status: 404,
                headers: { "content-type": "application/json; charset=utf-8" },
              },
            ),
    },
  },
});
