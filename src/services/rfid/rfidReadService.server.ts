import "@tanstack/react-start/server-only";
import type { RfidRead } from "./rfidReadSchemas";
import { rfidReadRepository, type RfidReadRepository } from "./rfidReadRepository.server";
import type { RfidReadResult } from "./rfidReadTypes";
export interface RfidReadService {
  processRead(
    read: RfidRead,
    context: { sourceSystem: string; requestId: string },
  ): Promise<RfidReadResult>;
}
export function createRfidReadService(
  repository: RfidReadRepository = rfidReadRepository,
): RfidReadService {
  return { processRead: (read, context) => repository.process(read, context) };
}
export const rfidReadService = createRfidReadService();
