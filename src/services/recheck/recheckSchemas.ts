import { z } from "zod";

const safeScan = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    "Scan must not contain control characters",
  );
export const recheckQueueFilterSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(160).optional(),
  alarmStatus: z.enum(["OPEN", "ACKNOWLEDGED", "ESCALATED", "SENT_TO_RECHECK"]).optional(),
  stationId: z.string().trim().max(120).optional(),
});
export const recheckTagSchema = safeScan;
export const hbssRecallSchema = z
  .object({
    alarmId: z.string().trim().min(1).max(128),
    expectedBagVersion: z.number().int().min(1),
    expectedAlarmVersion: z.number().int().min(1),
    stationId: z.string().trim().min(1).max(64).optional(),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict();
export const resolveRecheckSchema = z
  .object({
    alarmId: z.string().trim().min(1).max(128),
    expectedBagVersion: z.number().int().min(1),
    expectedAlarmVersion: z.number().int().min(1),
    disposition: z.enum(["CLEARED", "NOT_CLEARED"]),
    notes: z.string().trim().max(2_000).optional(),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.disposition === "NOT_CLEARED" && (!value.notes || value.notes.trim().length < 3))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "Notes are required when a bag is not cleared",
      });
  });
export type RecheckQueueFilters = z.infer<typeof recheckQueueFilterSchema>;
export type HbssRecallInput = z.infer<typeof hbssRecallSchema>;
export type ResolveRecheckInput = z.infer<typeof resolveRecheckSchema>;
