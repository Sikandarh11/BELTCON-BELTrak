import "@tanstack/react-start/server-only";

import {
  rfidActiveBagResolutionRepository,
  type RfidActiveBagResolutionRepository,
} from "./rfidActiveBagResolutionRepository.server";
import type { RfidActiveBagResolution } from "./rfidActiveBagResolutionSchemas";

export interface RfidActiveBagResolutionService {
  resolveActiveBagForDetection(detectionId: string): Promise<RfidActiveBagResolution>;
}

export function createRfidActiveBagResolutionService(options: {
  repository?: RfidActiveBagResolutionRepository;
} = {}): RfidActiveBagResolutionService {
  const repository = options.repository ?? rfidActiveBagResolutionRepository;

  return {
    async resolveActiveBagForDetection(detectionId) {
      return repository.resolveByDetectionId(detectionId);
    },
  };
}

export const rfidActiveBagResolutionService = createRfidActiveBagResolutionService();
