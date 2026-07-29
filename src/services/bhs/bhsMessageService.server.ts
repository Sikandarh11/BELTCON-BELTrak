import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  createBhsMessageFingerprint,
  createSemanticAcknowledgement,
  isTaggingEligibleEvaluation,
  normalizeScreeningEvaluation,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers";
import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import type { BhsBagMessageV1 } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types";
import { BhsMessagePersistenceError } from "./bhsMessageErrors";
import { bhsMessageRepository, type BhsMessageRepository } from "./bhsMessageRepository.server";
import type { BhsIngestionResult, NormalizedBhsMessage } from "./bhsMessageTypes";

export interface BhsIngestionContext {
  sourceSystem: string;
  requestId?: string | null;
  receivedAt?: string;
}

export interface BhsMessageService {
  ingestMessage(
    message: BhsBagMessageV1,
    context: BhsIngestionContext,
  ): Promise<BhsIngestionResult>;
}

export interface BhsMessageServiceDependencies {
  repository: BhsMessageRepository;
  createEventId: () => string;
  now: () => string;
}

function canonicalPayloadHash(sourceSystem: string, message: BhsBagMessageV1): string {
  const canonicalPayload = JSON.stringify({
    sourceSystem,
    messageType: message.messageType,
    trigger: message.trigger,
    lineId: message.lineId,
    bhsUid: message.bhsUid,
    evaluation: message.evaluation,
  });
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

export function normalizeBhsMessage(
  messageInput: BhsBagMessageV1,
  context: BhsIngestionContext,
  dependencies: Pick<BhsMessageServiceDependencies, "createEventId" | "now">,
): NormalizedBhsMessage {
  const message = BhsBagMessageV1Schema.parse(messageInput);
  const sourceSystem = context.sourceSystem.trim();
  if (!sourceSystem) {
    throw new BhsMessagePersistenceError("BHS integration source is required");
  }

  const evaluationNormalized = normalizeScreeningEvaluation(message.evaluation);
  return {
    messageType: message.messageType,
    trigger: message.trigger,
    lineId: message.lineId,
    bhsUid: message.bhsUid,
    evaluationRaw: message.evaluation,
    evaluationNormalized,
    taggingEligible: isTaggingEligibleEvaluation(evaluationNormalized),
    sourceSystem,
    sourceEventId: dependencies.createEventId(),
    messageFingerprint: createBhsMessageFingerprint(message),
    payloadHash: canonicalPayloadHash(sourceSystem, message),
    receivedAt: context.receivedAt ?? dependencies.now(),
    requestId: context.requestId?.trim() || null,
  };
}

const defaultDependencies: BhsMessageServiceDependencies = {
  repository: bhsMessageRepository,
  createEventId: randomUUID,
  now: () => new Date().toISOString(),
};

export function createBhsMessageService(
  overrides: Partial<BhsMessageServiceDependencies> = {},
): BhsMessageService {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    async ingestMessage(messageInput, context) {
      const normalized = normalizeBhsMessage(messageInput, context, dependencies);
      const result = await dependencies.repository.ingestAtomic(normalized);
      const outcome =
        result.status === "CONFLICT"
          ? "REJECTED"
          : result.status === "FAILED"
            ? "FAILED"
            : result.status;

      return {
        outcome,
        integrationEventId: result.integrationEventId,
        bagId: result.bagId,
        bhsUid: result.bhsUid || normalized.bhsUid,
        lineId: result.lineId || normalized.lineId,
        evaluation: result.evaluation,
        taggingEligible: result.taggingEligible,
        duplicate: result.status === "DUPLICATE",
        processingAttemptCount: result.processingAttemptCount,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        acknowledgement: createSemanticAcknowledgement(result.bhsUid || normalized.bhsUid, outcome),
      };
    },
  };
}

export const bhsMessageService = createBhsMessageService();
