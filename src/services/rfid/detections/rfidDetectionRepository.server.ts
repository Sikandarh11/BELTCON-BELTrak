import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";

import { RfidReadError } from "../events/rfidReadEventErrors";
import {
  RfidDetectionResultSchema,
  type RfidDetectionResult,
} from "./rfidDetectionSchemas";

const resultSchema = z
  .object({
    outcome: z.enum(["EPISODE_CREATED", "EPISODE_UPDATED", "LATE_EVENT_RECORDED"]),
    detectionId: z.string().uuid(),
    readPointId: z.string().uuid(),
    readPointCode: z.string(),
    readPointName: z.string(),
    readPointZone: z.string(),
    readerId: z.string(),
    epc: z.string(),
    antennaPort: z.number().int().min(1).max(64).nullable(),
    firstDetectedAt: z.string().datetime({ offset: true }),
    lastDetectedAt: z.string().datetime({ offset: true }),
    rawEventCount: z.number().int().min(1),
    totalReadCount: z.number().int().min(1),
    strongestRssiDbm: z.number().finite().nullable(),
    weakestRssiDbm: z.number().finite().nullable(),
    latestRssiDbm: z.number().finite().nullable(),
    simulated: z.boolean(),
  })
  .strict();

function isRetryableDbError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return code === "40001" || code === "40P01" || code === "55P03";
}

export interface ProcessStoredRfidEventInput {
  rfidEventId: string;
}

export interface RfidDetectionRepository {
  processStoredRfidEventAtomically(
    input: ProcessStoredRfidEventInput,
  ): Promise<RfidDetectionResult>;
}

async function processOnce(input: ProcessStoredRfidEventInput) {
  const { data, error } = await getSupabaseAdminClient().rpc(
    "process_beltcon_rfid_detection_v1",
    {
      p_rfid_event_id: input.rfidEventId,
    },
  );

  if (error) throw error;

  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    throw new RfidReadError(
      "RFID_DETECTION_PERSISTENCE_FAILED",
      "RFID detection result is invalid",
      500,
      { cause: parsed.error },
    );
  }

  return RfidDetectionResultSchema.parse(parsed.data);
}

export const rfidDetectionRepository: RfidDetectionRepository = {
  async processStoredRfidEventAtomically(input) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await processOnce(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/RFID_DETECTION_EVENT_TOO_OLD/.test(message)) {
          throw new RfidReadError(
            "RFID_DETECTION_EVENT_TOO_OLD",
            "RFID detection event is too old for processing",
            409,
            { cause: error },
          );
        }
        if (/RFID_READ_POINT_NOT_FOUND/.test(message)) {
          throw new RfidReadError(
            "RFID_READ_POINT_NOT_FOUND",
            "Read point was not found",
            404,
            { cause: error },
          );
        }
        if (/RFID_READ_POINT_DISABLED/.test(message)) {
          throw new RfidReadError(
            "RFID_READ_POINT_DISABLED",
            "Read point is disabled",
            409,
            { cause: error },
          );
        }
        if (/RFID_ANTENNA_MAPPING_MISSING/.test(message)) {
          throw new RfidReadError(
            "RFID_ANTENNA_MAPPING_MISSING",
            "Antenna mapping is missing",
            422,
            { cause: error },
          );
        }
        if (/RFID_DEDUP_POLICY_INVALID/.test(message)) {
          throw new RfidReadError(
            "RFID_DEDUP_POLICY_INVALID",
            "Deduplication policy is invalid",
            422,
            { cause: error },
          );
        }
        if (/RFID_DETECTION_CONFLICT/.test(message)) {
          throw new RfidReadError(
            "RFID_DETECTION_CONFLICT",
            "RFID event is already linked to a conflicting detection",
            409,
            { cause: error },
          );
        }
        if (isRetryableDbError(error) && attempt === 0) {
          continue;
        }
        if (error instanceof RfidReadError) throw error;
        throw new RfidReadError(
          "RFID_DETECTION_PERSISTENCE_FAILED",
          "RFID detection persistence failed",
          500,
          { cause: error },
        );
      }
    }

    throw new RfidReadError(
      "RFID_DETECTION_PERSISTENCE_FAILED",
      "RFID detection persistence failed",
      500,
    );
  },
};
