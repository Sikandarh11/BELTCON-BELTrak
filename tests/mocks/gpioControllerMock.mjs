import { createMockOperation, resetOperations } from "./mockOperation.mjs";

export function createGpioControllerMock(overrides = {}) {
  const controller = {
    activate: createMockOperation(
      "gpio.activate",
      overrides.activate ?? (async (channel) => ({ channel, active: true })),
    ),
    deactivate: createMockOperation(
      "gpio.deactivate",
      overrides.deactivate ?? (async (channel) => ({ channel, active: false })),
    ),
    allOff: createMockOperation("gpio.allOff", overrides.allOff ?? (async () => undefined)),
  };
  controller.reset = () => resetOperations(controller);
  return controller;
}
