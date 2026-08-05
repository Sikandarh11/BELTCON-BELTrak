import "@tanstack/react-start/server-only";

import {
  SimulatedAlarmOutputAdapter,
} from "./simulatedAlarmOutputAdapter.server";
import {
  UnavailablePhysicalAlarmOutputAdapter,
} from "./unavailablePhysicalAlarmOutputAdapter.server";
import type {
  AlarmOutputAdapter,
  AlarmOutputResult,
  TriggerAlarmOutputInput,
} from "./alarmOutputAdapter";

export interface AlarmOutputAdapterRuntimeOptions {
  simulatorEnabled?: boolean;
}

class AlarmOutputAdapterRuntime {
  private readonly adapter: AlarmOutputAdapter;

  constructor(options: AlarmOutputAdapterRuntimeOptions = {}) {
    this.adapter = options.simulatorEnabled === false
      ? new UnavailablePhysicalAlarmOutputAdapter()
      : new SimulatedAlarmOutputAdapter();
  }

  triggerAlarmOutput(input: TriggerAlarmOutputInput): Promise<AlarmOutputResult> {
    return this.adapter.triggerAlarmOutput(input);
  }
}

export const alarmOutputAdapterRuntime = new AlarmOutputAdapterRuntime({
  simulatorEnabled: true,
});
