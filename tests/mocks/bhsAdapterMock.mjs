import { createBhsMessage } from "../fixtures/bhsFixtures.mjs";
import { createMockOperation, resetOperations } from "./mockOperation.mjs";

export function createBhsAdapterMock(overrides = {}) {
  const adapter = {
    receive: createMockOperation(
      "bhs.receive",
      overrides.receive ??
        (async (message = createBhsMessage()) => ({
          messageType: 2002,
          bhsUid: message.bhsUid,
          outcome: "ACCEPTED",
          timing: "AFTER_DURABLE_COMMIT",
        })),
    ),
    acknowledge: createMockOperation("bhs.acknowledge", overrides.acknowledge ?? (async () => {})),
  };
  adapter.reset = () => resetOperations(adapter);
  return adapter;
}
