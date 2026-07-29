import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import type { RfidRead } from "./rfidReadSchemas";
import type { RfidReadResult } from "./rfidReadTypes";
import { RfidReadError } from "./rfidReadErrors";

const resultSchema = z.object({
  outcome: z.enum([
    "BAG_DETECTED",
    "EXIT_DETECTED",
    "ALARM_CREATED",
    "ALARM_ALREADY_ACTIVE",
    "BAG_ALREADY_RESOLVED",
    "BAG_ALREADY_AT_RECHECK",
    "BAG_STATE_CONFLICT",
    "UNASSIGNED_EPC",
    "DUPLICATE",
    "READER_NOT_FOUND",
    "READER_DISABLED",
    "ANTENNA_NOT_FOUND",
    "ANTENNA_DISABLED",
    "CONFLICT",
    "FAILED",
  ]),
  duplicate: z.boolean(),
  eventId: z.string().nullable().optional(),
  bagId: z.string().nullable().optional(),
  bhsUid: z.string().nullable().optional(),
  epc: z.string().nullable().optional(),
  readerId: z.string().nullable().optional(),
  antennaPort: z.number().int().nullable().optional(),
  zone: z.string().nullable().optional(),
  alarmEligible: z.boolean().optional(),
  previousStatus: z.string().nullable().optional(),
  currentStatus: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  alarm: z
    .object({
      id: z.string().min(1),
      status: z.string().min(1),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      created: z.boolean(),
    })
    .nullable()
    .optional(),
});

export interface RfidReadRepository {
  process(
    read: RfidRead,
    context: { sourceSystem: string; requestId: string },
  ): Promise<RfidReadResult>;
}
function fingerprint(read: RfidRead, sourceSystem: string) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceSystem,
        sourceEventId: read.sourceEventId,
        readerId: read.readerId,
        antennaPort: read.antennaPort,
        epc: read.epc,
        readAt: read.readAt,
        deviceSequence: read.deviceSequence ?? null,
        bootId: read.bootId ?? null,
      }),
    )
    .digest("hex");
}

export const rfidReadRepository: RfidReadRepository = {
  async process(read, context) {
    const { data, error } = await getXrayAdminClient().rpc("process_beltcon_rfid_read_v2", {
      p_event_id: randomUUID(),
      p_source_system: context.sourceSystem,
      p_source_event_id: read.sourceEventId,
      p_reader_id: read.readerId,
      p_antenna_port: read.antennaPort,
      p_epc: read.epc,
      p_device_occurred_at: read.readAt,
      p_rssi_dbm: read.rssiDbm ?? null,
      p_tid: read.tid ?? null,
      p_device_sequence: read.deviceSequence ?? null,
      p_boot_id: read.bootId ?? null,
      p_event_fingerprint: fingerprint(read, context.sourceSystem),
      p_request_id: context.requestId,
    });
    if (error)
      throw new RfidReadError("RFID_PROCESSING_FAILED", 500, "RFID read processing failed", {
        cause: error,
      });
    const parsed = resultSchema.safeParse(data);
    if (!parsed.success)
      throw new RfidReadError("RFID_PROCESSING_FAILED", 500, "RFID read result is invalid", {
        cause: parsed.error,
      });
    return {
      outcome: parsed.data.outcome,
      duplicate: parsed.data.duplicate,
      eventId: parsed.data.eventId ?? null,
      bagId: parsed.data.bagId ?? null,
      bhsUid: parsed.data.bhsUid ?? null,
      epc: parsed.data.epc ?? null,
      readerId: parsed.data.readerId ?? null,
      antennaPort: parsed.data.antennaPort ?? null,
      zone: parsed.data.zone ?? null,
      alarmEligible: parsed.data.alarmEligible ?? false,
      previousStatus: parsed.data.previousStatus ?? null,
      currentStatus: parsed.data.currentStatus ?? null,
      errorCode: parsed.data.errorCode ?? null,
      alarm: parsed.data.alarm ?? null,
    };
  },
};
