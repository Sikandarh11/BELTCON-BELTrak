import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const auditFiltersSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((value) => [10, 25, 50, 100].includes(value))
      .default(25),
    search: optionalText(120),
    action: optionalText(120),
    actorId: optionalText(120),
    targetType: z
      .enum(["BAG", "XRAY_SCAN", "INTEGRATION_EVENT", "READER", "ALARM", "OTHER"])
      .optional(),
    targetId: optionalText(160),
    outcome: optionalText(80),
    dateFrom: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "A valid ISO date is required")
      .optional(),
    dateTo: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "A valid ISO date is required")
      .optional(),
    requestId: optionalText(128),
  })
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && Date.parse(value.dateFrom) > Date.parse(value.dateTo)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateTo"],
        message: "Date from must be before date to",
      });
    }
  });
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

export type SafeAuditValue =
  | string
  | number
  | boolean
  | null
  | SafeAuditMetadata
  | SafeAuditValue[];
export interface SafeAuditMetadata {
  [key: string]: SafeAuditValue;
}

export interface AuditEventSummary {
  id: string;
  action: string;
  actorId: string | null;
  actorDisplayName: string | null;
  actorRole: string | null;
  targetType: string;
  targetId: string | null;
  outcome: string;
  summary: string;
  metadata: SafeAuditMetadata;
  requestId: string | null;
  createdAt: string;
}

export interface AuditEventDetail extends AuditEventSummary {
  bagId: string | null;
  xrayScanId: string | null;
  integrationEventId: string | null;
  sourceSystem: string | null;
  errorCode: string | null;
}

export interface AuditListResponse {
  items: AuditEventSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
