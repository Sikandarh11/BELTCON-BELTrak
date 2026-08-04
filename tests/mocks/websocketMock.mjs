import { createMockOperation } from "./mockOperation.mjs";

export function createWebsocketEventCollector() {
  const events = [];
  const collect = createMockOperation("websocket.collect", (type, payload) => {
    const event = { type, payload: structuredClone(payload) };
    events.push(event);
    return event;
  });

  return {
    events,
    collect,
    byType: (type) => events.filter((event) => event.type === type),
    reset() {
      events.length = 0;
      collect.reset();
    },
  };
}
