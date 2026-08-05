import "@tanstack/react-start/server-only";

import {
  customsExitAlarmRepository,
  type CustomsExitAlarmRepository,
  type CustomsExitAlarmResult,
} from "./customsExitAlarmRepository.server";
import {
  alarmOutputAdapterRuntime,
} from "./output/alarmOutputAdapterRuntime.server";
import type { AlarmOutputAdapter } from "./output/alarmOutputAdapter";

export type { CustomsExitAlarmResult } from "./customsExitAlarmRepository.server";

export interface CustomsExitAlarmService {
  processForDetection(detectionId: string): Promise<CustomsExitAlarmResult>;
}

export function createCustomsExitAlarmService(options: {
  repository?: CustomsExitAlarmRepository;
  outputAdapter?: AlarmOutputAdapter;
} = {}): CustomsExitAlarmService {
  const repository = options.repository ?? customsExitAlarmRepository;
  const outputAdapter = options.outputAdapter ?? alarmOutputAdapterRuntime;
  return {
    async processForDetection(detectionId) {
      const result = await repository.processByDetectionId(detectionId);
      if (result.outcome === "ALARM_CREATED") {
        const alarmId = result.alarmId ?? "";
        const bagId = result.bagId ?? "";
        if (alarmId && bagId) {
          const output = await outputAdapter.triggerAlarmOutput({
            alarmId,
            bagId,
            severity: result.severity ?? "HIGH",
            readerId: null,
            durationMs: 5000,
          });
          return { ...result, output };
        }
      }
      return result;
    },
  };
}

export const customsExitAlarmService = createCustomsExitAlarmService();
