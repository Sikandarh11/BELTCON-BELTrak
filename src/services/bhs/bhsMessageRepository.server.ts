import "@tanstack/react-start/server-only";

import { z } from "zod";

import {
  BhsLineIdSchema,
  BhsUidSchema,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import { BhsMessagePersistenceError } from "./bhsMessageErrors";
import type { BhsAtomicResult, NormalizedBhsMessage } from "./bhsMessageTypes";

const bhsAtomicResultSchema = z.object({
  status: z.enum(["ACCEPTED", "DUPLICATE", "CONFLICT", "FAILED"]),
  integrationEventId: z.string().uuid().nullable(),
  bagId: z.string().nullable(),
  bhsUid: BhsUidSchema,
  lineId: BhsLineIdSchema,
  evaluation: z.enum(["ACCEPT", "REJECT", "TIMEOUT", "NO_DECISION", "MISTRACK"]).nullable(),
  taggingEligible: z.boolean(),
  canAssignTag: z.boolean(),
  taggingReadinessStatus: z
    .enum([
      "NOT_READY",
      "AWAITING_BHS",
      "AWAITING_SCREENING",
      "AWAITING_XRAY",
      "READY_FOR_TAGGING",
      "BLOCKED_CONFLICT",
    ])
    .nullable(),
  processingAttemptCount: z.number().int().min(0),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export interface BhsMessageRepository {
  ingestAtomic(message: NormalizedBhsMessage): Promise<BhsAtomicResult>;
}

export type BhsRpcCall = (message: NormalizedBhsMessage) => Promise<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

const callBhsIngestionRpc: BhsRpcCall = async (message) => {
  const functionName =
    message.stationId && message.siteId
      ? "ingest_beltcon_bhs_station_message_v1"
      : "ingest_beltcon_bhs_message_v2";
  const { data, error } = await getXrayAdminClient().rpc(functionName, {
    p_message: {
      messageType: message.messageType,
      trigger: message.trigger,
      lineId: message.lineId,
      bhsUid: message.bhsUid,
      evaluation: message.evaluationRaw,
    },
    p_source_system: message.sourceSystem,
    p_message_fingerprint: message.messageFingerprint,
    p_payload_hash: message.payloadHash,
    p_event_id: message.sourceEventId,
    p_request_id: message.requestId,
    ...(message.stationId && message.siteId
      ? { p_station_id: message.stationId, p_site_id: message.siteId }
      : {}),
  });

  return {
    data,
    error: error ? { message: error.message, code: error.code } : null,
  };
};

export function createBhsMessageRepository(
  rpcCall: BhsRpcCall = callBhsIngestionRpc,
): BhsMessageRepository {
  return {
    async ingestAtomic(message) {
      let response: Awaited<ReturnType<BhsRpcCall>>;
      try {
        response = await rpcCall(message);
      } catch (error) {
        throw new BhsMessagePersistenceError("BHS transaction request failed", { cause: error });
      }

      if (response.error) {
        throw new BhsMessagePersistenceError("BHS transaction failed", { cause: response.error });
      }

      const parsed = bhsAtomicResultSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new BhsMessagePersistenceError("BHS transaction returned an invalid result", {
          cause: parsed.error,
        });
      }

      return parsed.data;
    },
  };
}

export const bhsMessageRepository = createBhsMessageRepository();
