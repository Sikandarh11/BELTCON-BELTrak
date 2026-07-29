import "@tanstack/react-start/server-only";

import type { ScreeningSuspectEvent } from "@/types/screening";
import {
  ScreeningConflictError,
  ScreeningPersistenceError,
  ScreeningServiceError,
} from "./screeningErrors";
import { hashScreeningPayload } from "./screeningHash.server";
import {
  screeningRepository,
  type ScreeningAtomicResult,
  type ScreeningRepository,
} from "./screeningRepository.server";

export interface ScreeningIngestionResult {
  status: "ACCEPTED" | "DUPLICATE";
  eventId: string;
  bagId: string;
  scanId: string;
  scanStatus: "AVAILABLE" | "PENDING" | "FAILED" | "NOT_FOUND" | "ARCHIVED";
  screeningReceived: boolean;
  bhsConfirmationStatus: "AWAITING_BHS_CONFIRMATION" | "CONFIRMED" | null;
  canAssignTag: boolean;
}

export interface ScreeningIngestionContext {
  requestId?: string;
}

export interface ScreeningIngestionService {
  ingestSuspectEvent(
    event: ScreeningSuspectEvent,
    context?: ScreeningIngestionContext,
  ): Promise<ScreeningIngestionResult>;
}

export interface ScreeningIngestionDependencies {
  repository: ScreeningRepository;
  hashPayload: (event: ScreeningSuspectEvent) => string;
}

const conflictMessages: Record<string, string> = {
  EVENT_ID_PAYLOAD_CONFLICT: "Event ID was already used with a different payload",
  BHS_IDENTITY_CONFLICT: "BHS UID is already assigned to another event",
  BAG_LIFECYCLE_CONFLICT: "The existing bag lifecycle cannot be reset",
  EXTERNAL_SCAN_ID_CONFLICT: "External scan ID is already assigned to another bag",
  ORIGINAL_RESULT_UNAVAILABLE: "The original idempotent result is no longer available",
};

function requireSuccessfulResult(result: ScreeningAtomicResult): ScreeningIngestionResult {
  if (result.status === "CONFLICT") {
    const conflictCode = result.errorCode ?? "SCREENING_IDENTITY_CONFLICT";
    throw new ScreeningConflictError(
      conflictMessages[conflictCode] ?? "Screening event conflicts with existing data",
      conflictCode,
    );
  }

  if (result.status === "FAILED") {
    throw new ScreeningPersistenceError("The screening transaction could not be completed");
  }

  if (!result.bagId || !result.scanId || !result.scanStatus) {
    throw new ScreeningPersistenceError(
      "The screening transaction did not return its bag and scan",
    );
  }

  return {
    status: result.status,
    eventId: result.eventId,
    bagId: result.bagId,
    scanId: result.scanId,
    scanStatus: result.scanStatus,
    screeningReceived: result.screeningReceived,
    bhsConfirmationStatus: result.bhsConfirmationStatus,
    canAssignTag: result.canAssignTag,
  };
}

const defaultDependencies: ScreeningIngestionDependencies = {
  repository: screeningRepository,
  hashPayload: hashScreeningPayload,
};

export function createScreeningIngestionService(
  overrides: Partial<ScreeningIngestionDependencies> = {},
): ScreeningIngestionService {
  const dependencies: ScreeningIngestionDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  return {
    async ingestSuspectEvent(event, context = {}) {
      const payloadHash = dependencies.hashPayload(event);

      try {
        const result = await dependencies.repository.ingestAtomic({
          event,
          payloadHash,
          requestId: context.requestId?.trim() || null,
        });
        return requireSuccessfulResult(result);
      } catch (error) {
        if (error instanceof ScreeningServiceError) {
          throw error;
        }

        throw new ScreeningPersistenceError("Screening transaction failed", {
          cause: error,
        });
      }
    },
  };
}

export const screeningIngestionService = createScreeningIngestionService();
export const ingestSuspectEvent = screeningIngestionService.ingestSuspectEvent;
