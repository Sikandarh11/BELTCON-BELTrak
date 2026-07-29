import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { BhsUidSchema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import {
  Rs232HbssRecallAdapter,
  SimulatedHbssRecallAdapter,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.adapters";
import type { HbssRecallAdapter } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types";
import type { CanonicalRole } from "@/auth/canonicalRoles";
import { RecheckServiceError } from "./recheckErrors";
import { recheckRepository, type RecheckRepository } from "./recheckRepository.server";
import type { HbssRecallInput, RecheckQueueFilters, ResolveRecheckInput } from "./recheckSchemas";

function adapterForEnvironment(): { type: "SIMULATED" | "RS232"; adapter: HbssRecallAdapter } {
  const configured = process.env.HBSS_RECALL_ADAPTER?.trim().toUpperCase();
  if (configured === "RS232") return { type: "RS232", adapter: new Rs232HbssRecallAdapter() };
  return { type: "SIMULATED", adapter: new SimulatedHbssRecallAdapter() };
}
function failure(status: string) {
  const map: Record<string, [string, RecheckServiceError["code"], number]> = {
    BAG_NOT_FOUND: ["Bag was not found", "RECHECK_BAG_NOT_FOUND", 404],
    ALARM_NOT_FOUND: ["Alarm was not found", "RECHECK_ALARM_NOT_FOUND", 404],
    ALARM_MISMATCH: ["Alarm does not belong to this bag", "RECHECK_ALARM_MISMATCH", 409],
    VERSION_CONFLICT: [
      "This Recheck case was changed by another user",
      "RECHECK_VERSION_CONFLICT",
      409,
    ],
    INVALID_BAG_STATE: ["Bag is not eligible for Recheck", "RECHECK_INVALID_BAG_STATE", 409],
    INVALID_ALARM_STATE: ["Alarm is not eligible for Recheck", "RECHECK_INVALID_ALARM_STATE", 409],
    BHS_UID_REQUIRED: [
      "A valid BHS BagID is required for HBSS recall",
      "HBSS_BHS_UID_REQUIRED",
      409,
    ],
    RESOLUTION_CONFLICT: [
      "This Recheck case already has a final resolution",
      "RECHECK_RESOLUTION_CONFLICT",
      409,
    ],
  };
  return map[status] ?? ["Unable to process Recheck request", "RECHECK_PROCESSING_FAILED", 500];
}
export function createRecheckService(repository: RecheckRepository = recheckRepository) {
  return {
    queue: (filters: RecheckQueueFilters) => repository.queue(filters),
    async caseByTag(tag: string) {
      const value = tag.trim();
      if (!value)
        throw new RecheckServiceError(
          "An RFID label barcode or EPC is required",
          "RECHECK_TAG_REQUIRED",
          400,
        );
      const result = await repository.findByTag(value);
      if (!result)
        throw new RecheckServiceError(
          "No active Recheck case was found for this tag",
          "RECHECK_CASE_NOT_FOUND",
          404,
        );
      return result;
    },
    async caseByBag(bagId: string) {
      const result = await repository.caseForBag(bagId);
      if (!result)
        throw new RecheckServiceError(
          "No active Recheck case was found",
          "RECHECK_CASE_NOT_FOUND",
          404,
        );
      return result;
    },
    recalls: (bagId: string) => repository.recalls(bagId),
    async recall(
      input: HbssRecallInput & {
        bagId: string;
        actorId: string;
        canonicalRole: CanonicalRole;
        requestId?: string;
      },
    ) {
      const requestId = input.requestId ?? randomUUID();
      const selected = adapterForEnvironment();
      const started = await repository.beginRecall({
        p_bag_id: input.bagId,
        p_alarm_id: input.alarmId,
        p_expected_bag_version: input.expectedBagVersion,
        p_expected_alarm_version: input.expectedAlarmVersion,
        p_actor_id: input.actorId,
        p_station_id: input.stationId ?? "RECHECK",
        p_adapter_type: selected.type,
        p_idempotency_key: input.idempotencyKey,
        p_request_id: requestId,
      });
      const status = String(started.status ?? "FAILED");
      if (status === "DUPLICATE") return { recall: started.recall, duplicate: true };
      if (status !== "CREATED") {
        const [message, code, httpStatus] = failure(status);
        throw new RecheckServiceError(message, code, httpStatus);
      }
      const record = started.recall as Record<string, unknown>;
      const recallId = String(record.id);
      const bhsUid = BhsUidSchema.parse(started.bhsUid);
      try {
        const adapterResult = await selected.adapter.recall({
          bagId: input.bagId,
          bhsUid,
          stationId: input.stationId ?? "RECHECK",
          requestedAt: new Date().toISOString(),
          requestedBy: input.actorId,
        });
        const completed = await repository.completeRecall({
          p_recall_id: recallId,
          p_status: adapterResult.status,
          p_error_code: null,
          p_error_message: adapterResult.message ?? null,
          p_response_metadata: { message: adapterResult.message ?? null },
          p_request_id: requestId,
        });
        return { recall: completed.recall, duplicate: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "HBSS recall failed";
        const completed = await repository.completeRecall({
          p_recall_id: recallId,
          p_status: "FAILED",
          p_error_code: "HBSS_RECALL_FAILED",
          p_error_message: message,
          p_response_metadata: {},
          p_request_id: requestId,
        });
        return { recall: completed.recall, duplicate: false };
      }
    },
    async resolve(
      input: ResolveRecheckInput & {
        bagId: string;
        actorId: string;
        canonicalRole: CanonicalRole;
        requestId?: string;
      },
    ) {
      const result = await repository.resolve({
        p_bag_id: input.bagId,
        p_alarm_id: input.alarmId,
        p_expected_bag_version: input.expectedBagVersion,
        p_expected_alarm_version: input.expectedAlarmVersion,
        p_disposition: input.disposition,
        p_notes: input.notes ?? null,
        p_actor_id: input.actorId,
        p_canonical_role: input.canonicalRole,
        p_idempotency_key: input.idempotencyKey,
        p_request_id: input.requestId ?? randomUUID(),
      });
      const status = String(result.status ?? "FAILED");
      if (!["RESOLVED", "DUPLICATE"].includes(status)) {
        const [message, code, httpStatus] = failure(status);
        throw new RecheckServiceError(message, code, httpStatus);
      }
      return result;
    },
  };
}
export const recheckService = createRecheckService();
export type RecheckService = typeof recheckService;
