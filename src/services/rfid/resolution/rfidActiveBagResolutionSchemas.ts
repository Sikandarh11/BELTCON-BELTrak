import { z } from "zod";

export const RfidActiveBagResolutionOutcomeSchema = z.enum([
  "ACTIVE_SUSPECT_BAG",
  "UNASSIGNED_EPC",
  "TAG_NOT_ACTIVE",
  "BAG_NOT_ALARM_ELIGIBLE",
]);

export type RfidActiveBagResolutionOutcome = z.infer<
  typeof RfidActiveBagResolutionOutcomeSchema
>;

export const RfidActiveBagResolutionSchema = z.object({
  outcome: RfidActiveBagResolutionOutcomeSchema,

  detectionId: z.string().min(1),
  epc: z.string().min(1),

  tagAssignmentId: z.string().min(1).nullable(),
  bagId: z.string().min(1).nullable(),

  assignmentStatus: z.string().nullable(),
  bagStatus: z.string().nullable(),

  alarmEligible: z.boolean(),
});

export type RfidActiveBagResolution = z.infer<
  typeof RfidActiveBagResolutionSchema
>;