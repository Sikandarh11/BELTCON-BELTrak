import { z } from "zod";

import { READER_ZONES } from "@/services/readers/readerSchemas";

export const REPORT_TYPES = [
  "bag-lifecycle",
  "tagging",
  "rfid",
  "alarms",
  "recheck",
  "readers",
  "integrations",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const dateInput = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "A valid ISO date is required");

export const reportFiltersSchema = z
  .object({
    dateFrom: dateInput.optional(),
    dateTo: dateInput.optional(),
    bhsLineId: z
      .string()
      .trim()
      .max(2)
      .optional()
      .transform((value) => value || undefined),
    screeningEvaluation: z
      .enum(["ACCEPT", "REJECT", "TIMEOUT", "NO_DECISION", "MISTRACK"])
      .optional(),
    bagStatus: z.string().trim().max(64).optional(),
    zone: z.enum(READER_ZONES).optional(),
    readerId: z.string().trim().max(160).optional(),
    alarmStatus: z.string().trim().max(64).optional(),
    alarmSeverity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    resolutionDisposition: z.enum(["CLEARED", "NOT_CLEARED"]).optional(),
    integrationSource: z.string().trim().max(120).optional(),
  })
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo) {
      const range = Date.parse(value.dateTo) - Date.parse(value.dateFrom);
      if (range < 0)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dateTo"],
          message: "Date from must be before date to",
        });
      if (range > 90 * 24 * 60 * 60 * 1000) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dateTo"],
          message: "The maximum interactive report range is 90 days",
        });
      }
    }
  });
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export interface OperationalReport {
  requestId: string;
  reportType: ReportType;
  filters: ReportFilters;
  summary: Record<string, number>;
  series: Array<{ timestamp: string; value: number }>;
  breakdowns: Record<string, Array<Record<string, string | number | null>>>;
  generatedAt: string;
  dataLimitations: string[];
}
