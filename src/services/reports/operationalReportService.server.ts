import "@tanstack/react-start/server-only";

import {
  operationalReportRepository,
  type OperationalReportRepository,
} from "./operationalReportRepository.server";
import type { OperationalReport, ReportFilters, ReportType } from "./reportSchemas";

export interface OperationalReportService {
  generate(
    reportType: ReportType,
    filters: ReportFilters,
    requestId: string,
  ): Promise<OperationalReport>;
}

export function createOperationalReportService(
  repository: OperationalReportRepository = operationalReportRepository,
): OperationalReportService {
  return {
    generate: (reportType, filters, requestId) =>
      repository.generate(reportType, filters, requestId),
  };
}

export const operationalReportService = createOperationalReportService();
