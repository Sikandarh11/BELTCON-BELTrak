import { z } from "zod";

const safeIdentifier = /^[A-Za-z0-9._:/+-]+$/;
const ISO_FUTURE_ALLOWANCE_MS = 10 * 60 * 1_000;

export const rfidReadSchema = z
  .object({
    sourceEventId: z.string().trim().min(1).max(128).regex(safeIdentifier),
    readerId: z.string().trim().min(1).max(128).regex(safeIdentifier),
    antennaPort: z.number().int().min(1).max(64),
    epc: z.string().trim().min(1).max(128).regex(safeIdentifier),
    readAt: z
      .string()
      .datetime({ offset: true })
      .refine(
        (value) => new Date(value).getTime() <= Date.now() + ISO_FUTURE_ALLOWANCE_MS,
        "RFID read time is too far in the future",
      ),
    rssiDbm: z.number().finite().min(-130).max(20).optional(),
    tid: z.string().trim().min(1).max(256).regex(safeIdentifier).optional(),
    deviceSequence: z.number().int().nonnegative().optional(),
    bootId: z.string().trim().min(1).max(128).regex(safeIdentifier).optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    epc: value.epc.toUpperCase(),
    readerId: value.readerId.toUpperCase(),
    tid: value.tid?.toUpperCase(),
  }));

export type RfidRead = z.output<typeof rfidReadSchema>;

export const readerAntennaMapSchema = z.object({
  readerId: z.string(),
  readerName: z.string(),
  readerStatus: z.string(),
  antennaId: z.string().uuid(),
  antennaPort: z.number().int().min(1).max(64),
  antennaName: z.string(),
  zoneCode: z.enum([
    "TAGGING",
    "RECLAIM",
    "CUSTOMS_EXIT",
    "RECHECK",
    "WASHROOM",
    "EMPLOYEE_EXIT",
    "EMERGENCY_EXIT",
    "LOST_AND_FOUND",
    "CORRIDOR",
    "OTHER",
  ]),
  direction: z.string().nullable(),
  enabled: z.boolean(),
});
export type ReaderAntennaMap = z.infer<typeof readerAntennaMapSchema>;
