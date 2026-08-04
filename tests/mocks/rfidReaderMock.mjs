import { createRfidEvent } from "../fixtures/tagFixtures.mjs";
import { createMockOperation } from "./mockOperation.mjs";

export function createRfidReaderMock() {
  const listeners = new Set();
  const emitRead = createMockOperation("rfidReader.emitRead", async (read = createRfidEvent()) => {
    for (const listener of listeners) await listener(structuredClone(read));
    return structuredClone(read);
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitRead,
    reset() {
      listeners.clear();
      emitRead.reset();
    },
  };
}
