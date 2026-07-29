import { z } from "zod";

export const ALARM_WORKFLOW_STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "ESCALATED",
  "SENT_TO_RECHECK",
  "CLOSED",
] as const;

export const ACTIVE_ALARM_WORKFLOW_STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "ESCALATED",
  "SENT_TO_RECHECK",
] as const;

export const alarmWorkflowStatusSchema = z.enum(ALARM_WORKFLOW_STATUSES);
export const alarmSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const alarmListFilterSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  statuses: z.array(alarmWorkflowStatusSchema).max(ALARM_WORKFLOW_STATUSES.length).default([]),
  severity: alarmSeveritySchema.optional(),
  zone: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(160).optional(),
  openedFrom: z.string().datetime().optional(),
  openedTo: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const acknowledgeAlarmSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const escalateAlarmSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const sendToRecheckSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
    recheckStationId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type AlarmListFilters = z.infer<typeof alarmListFilterSchema>;
export type AlarmWorkflowStatus = z.infer<typeof alarmWorkflowStatusSchema>;
export type AlarmSeverity = z.infer<typeof alarmSeveritySchema>;
export type AcknowledgeAlarmInput = z.infer<typeof acknowledgeAlarmSchema>;
export type EscalateAlarmInput = z.infer<typeof escalateAlarmSchema>;
export type SendToRecheckInput = z.infer<typeof sendToRecheckSchema>;
