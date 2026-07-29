import "@tanstack/react-start/server-only";

import type { CanonicalRole } from "@/auth/canonicalRoles";
import { AlarmServiceError } from "./alarmErrors";
import {
  alarmRepository,
  type AlarmDetail,
  type AlarmListResult,
  type AlarmMutationCommand,
  type AlarmRepository,
} from "./alarmRepository.server";
import type {
  AcknowledgeAlarmInput,
  AlarmListFilters,
  EscalateAlarmInput,
  SendToRecheckInput,
} from "./alarmSchemas";

function requestId() {
  return crypto.randomUUID();
}

function failedStatus(status: string) {
  switch (status) {
    case "NOT_FOUND":
      return ["Alarm was not found", "ALARM_NOT_FOUND", 404] as const;
    case "VERSION_CONFLICT":
      return ["This alarm was changed by another user", "ALARM_VERSION_CONFLICT", 409] as const;
    case "REASON_REQUIRED":
      return ["A reason is required", "ALARM_REASON_REQUIRED", 400] as const;
    case "BAG_NOT_FOUND":
      return ["The associated bag was not found", "ALARM_BAG_NOT_FOUND", 409] as const;
    case "BAG_STATE_CONFLICT":
      return [
        "The bag is not eligible for this alarm action",
        "ALARM_BAG_STATE_CONFLICT",
        409,
      ] as const;
    default:
      return [
        "The alarm is not in a valid state for this action",
        "ALARM_INVALID_STATE",
        409,
      ] as const;
  }
}

export interface AlarmService {
  list(filters: AlarmListFilters): Promise<AlarmListResult>;
  get(alarmId: string): Promise<AlarmDetail>;
  acknowledge(input: AcknowledgeAlarmInput & AlarmCommandContext): Promise<AlarmDetail>;
  escalate(input: EscalateAlarmInput & AlarmCommandContext): Promise<AlarmDetail>;
  sendToRecheck(input: SendToRecheckInput & AlarmCommandContext): Promise<AlarmDetail>;
}

export interface AlarmCommandContext {
  alarmId: string;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId?: string;
}

export function createAlarmService(repository: AlarmRepository = alarmRepository): AlarmService {
  async function run(
    action: "acknowledge" | "escalate" | "sendToRecheck",
    input: AlarmMutationCommand,
  ) {
    const result = await repository.mutate(action, input);
    const status = typeof result.status === "string" ? result.status : "FAILED";
    if (!["ACKNOWLEDGED", "ESCALATED", "SENT_TO_RECHECK"].includes(status)) {
      const [message, code, httpStatus] = failedStatus(status);
      try {
        await repository.recordRejected({
          actorId: input.actorId,
          canonicalRole: input.canonicalRole,
          alarmId: input.alarmId,
          requestId: input.requestId,
          code,
        });
      } catch {
        // The primary state error remains authoritative; reject auditing is best effort on DB faults.
      }
      throw new AlarmServiceError(message, code, httpStatus);
    }
    const alarm = await repository.getById(input.alarmId);
    if (!alarm) {
      throw new AlarmServiceError("Alarm was not found", "ALARM_NOT_FOUND", 404);
    }
    return alarm;
  }

  return {
    list: (filters) => repository.list(filters),
    async get(alarmId) {
      const alarm = await repository.getById(alarmId);
      if (!alarm) throw new AlarmServiceError("Alarm was not found", "ALARM_NOT_FOUND", 404);
      return alarm;
    },
    acknowledge: (input) =>
      run("acknowledge", {
        ...input,
        requestId: input.requestId ?? requestId(),
      }),
    escalate: (input) =>
      run("escalate", {
        ...input,
        requestId: input.requestId ?? requestId(),
      }),
    sendToRecheck: (input) =>
      run("sendToRecheck", {
        ...input,
        requestId: input.requestId ?? requestId(),
      }),
  };
}

export const alarmService = createAlarmService();
