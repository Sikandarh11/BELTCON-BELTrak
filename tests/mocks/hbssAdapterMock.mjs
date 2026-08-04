import { createHbssScan } from "../fixtures/hbssFixtures.mjs";
import { createMockOperation, resetOperations } from "./mockOperation.mjs";

export function createHbssAdapterMock(overrides = {}) {
  const adapter = {
    name: "P1_HBSS_MOCK",
    getScanByBhsUid: createMockOperation(
      "hbss.getScanByBhsUid",
      overrides.getScanByBhsUid ?? (async (bhsUid) => createHbssScan({ bhsUid })),
    ),
    healthCheck: createMockOperation(
      "hbss.healthCheck",
      overrides.healthCheck ?? (async () => ({ healthy: true, message: "P1 deterministic mock" })),
    ),
    recall: createMockOperation(
      "hbss.recall",
      overrides.recall ??
        (async (request) => ({
          status: "SIMULATED",
          requestedAt: request.requestedAt,
          completedAt: request.requestedAt,
          message: "P1 deterministic recall",
        })),
    ),
  };
  adapter.reset = () => resetOperations(adapter);
  return adapter;
}
