import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { ScreeningSuspectEvent } from "@/types/screening";
import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import { ScreeningPersistenceError } from "./screeningErrors";

const screeningAtomicResultSchema = z.object({
  status: z.enum(["ACCEPTED", "DUPLICATE", "CONFLICT", "FAILED"]),
  eventId: z.string().uuid(),
  bagId: z.string().nullable(),
  scanId: z.string().uuid().nullable(),
  scanStatus: z.enum(["AVAILABLE", "PENDING", "FAILED", "NOT_FOUND", "ARCHIVED"]).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export type ScreeningAtomicResult = z.infer<typeof screeningAtomicResultSchema>;

export interface ScreeningAtomicCommand {
  event: ScreeningSuspectEvent;
  payloadHash: string;
  requestId: string | null;
}

export interface ScreeningRepository {
  ingestAtomic(command: ScreeningAtomicCommand): Promise<ScreeningAtomicResult>;
}

interface ScreeningRpcError {
  code?: string;
  message: string;
}

interface ScreeningRpcResponse {
  data: unknown;
  error: ScreeningRpcError | null;
}

export type ScreeningRpcCall = (command: ScreeningAtomicCommand) => Promise<ScreeningRpcResponse>;

const callAtomicScreeningRpc: ScreeningRpcCall = async (command) => {
  const { data, error } = await getXrayAdminClient().rpc("ingest_screening_suspect_event_v1", {
    p_event: command.event,
    p_payload_hash: command.payloadHash,
    p_request_id: command.requestId,
  });

  return {
    data,
    error: error
      ? {
          code: error.code,
          message: error.message,
        }
      : null,
  };
};

export function createScreeningRepository(
  rpcCall: ScreeningRpcCall = callAtomicScreeningRpc,
): ScreeningRepository {
  return {
    async ingestAtomic(command) {
      let response: ScreeningRpcResponse;
      try {
        response = await rpcCall(command);
      } catch (error) {
        throw new ScreeningPersistenceError("Screening transaction request failed", {
          cause: error,
        });
      }

      if (response.error) {
        throw new ScreeningPersistenceError("Screening transaction failed", {
          cause: response.error,
        });
      }

      const parsed = screeningAtomicResultSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new ScreeningPersistenceError("Screening transaction returned an invalid result", {
          cause: parsed.error,
        });
      }

      return parsed.data;
    },
  };
}

export const screeningRepository = createScreeningRepository();
