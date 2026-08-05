import "@tanstack/react-start/server-only";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";

import { RfidReadError } from "../events/rfidReadEventErrors";
import { BaselineRfidDetectionResultSchema, type RfidDetectionResult } from "./rfidDetectionSchemas";

export interface ProcessStoredRfidEventInput {
  rfidEventId: string;
}

export interface RfidDetectionRepository {
  processStoredRfidEventAtomically(input: ProcessStoredRfidEventInput): Promise<RfidDetectionResult>;
}

function parseResult(data: unknown): RfidDetectionResult {
  const parsed = BaselineRfidDetectionResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new RfidReadError("RFID_DETECTION_PERSISTENCE_FAILED", "RFID detection result is invalid", 500, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function processOnce(input: ProcessStoredRfidEventInput) {
  const { data, error } = await getSupabaseAdminClient().rpc("process_beltcon_baseline_rfid_detection_v1", {
    p_rfid_event_id: input.rfidEventId,
  });
  if (error) throw error;
  return parseResult(data);
}

function isRetryableDbError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "40001" || code === "40P01" || code === "55P03";
}

export const rfidDetectionRepository: RfidDetectionRepository = {
  async processStoredRfidEventAtomically(input) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await processOnce(input);
      } catch (error) {
        if (isRetryableDbError(error) && attempt === 0) continue;
        if (error instanceof RfidReadError) throw error;
        throw new RfidReadError("RFID_DETECTION_PERSISTENCE_FAILED", "RFID detection persistence failed", 500, {
          cause: error,
        });
      }
    }
    throw new RfidReadError("RFID_DETECTION_PERSISTENCE_FAILED", "RFID detection persistence failed", 500);
  },
};
