import "@tanstack/react-start/server-only";

import type { ScreeningSuspectEvent } from "@/types/screening";
import type { ScreeningAdapter } from "./screeningAdapter";
import {
  normalizeScreeningSuspectEvent,
  parseTrustedSourceSystem,
  screeningSimulatorInputSchema,
} from "./screeningSchemas";

export const DEFAULT_MOCK_SCREENING_SOURCE = "SIMULATED_HBSS";

export interface MockScreeningAdapter extends ScreeningAdapter {
  normalizeSimulatorEvent(payload: unknown): ScreeningSuspectEvent;
}

export function createMockScreeningAdapter(
  sourceSystemInput = DEFAULT_MOCK_SCREENING_SOURCE,
): MockScreeningAdapter {
  const sourceSystem = parseTrustedSourceSystem(sourceSystemInput);

  return {
    sourceSystem,
    normalizeSuspectEvent(payload) {
      return normalizeScreeningSuspectEvent(payload, sourceSystem);
    },
    normalizeSimulatorEvent(payload) {
      const input = screeningSimulatorInputSchema.parse(payload);

      return normalizeScreeningSuspectEvent(
        {
          schemaVersion: 1,
          eventId: input.eventId,
          eventType: "BAG_SUSPECTED",
          occurredAt: input.screeningTimestamp,
          bag: {
            bhsUid: input.bhsUid,
            iataCode: input.iataCode,
            iataOrigin: input.iataOrigin,
            flightNo: input.flightNo,
            passengerName: input.passengerName,
          },
          screening: {
            station: input.screeningStation,
            screenedAt: input.screeningTimestamp,
          },
          threat: {
            type: input.threatType,
            level: input.threatLevel,
          },
          scan: {
            externalScanId: input.externalScanId,
            status: input.scanStatus,
            images: input.images,
          },
        },
        sourceSystem,
      );
    },
  };
}

export const mockScreeningAdapter = createMockScreeningAdapter();
