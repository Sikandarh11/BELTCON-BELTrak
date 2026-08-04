import { createMockOperation } from "./mockOperation.mjs";

export function createMessageBusMock() {
  const subscribers = new Map();
  const messages = [];
  const publish = createMockOperation("messageBus.publish", async (topic, payload) => {
    const message = { topic, payload: structuredClone(payload) };
    messages.push(message);
    for (const subscriber of subscribers.get(topic) ?? []) {
      await subscriber(structuredClone(payload), topic);
    }
    return message;
  });

  return {
    messages,
    publish,
    subscribe(topic, listener) {
      const listeners = subscribers.get(topic) ?? new Set();
      listeners.add(listener);
      subscribers.set(topic, listeners);
      return () => listeners.delete(listener);
    },
    reset() {
      messages.length = 0;
      subscribers.clear();
      publish.reset();
    },
  };
}
