import type { BhsBagMessageV1 } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types";
import { encodeBhsWireMessage2001 } from "./bhsWireCodec";
import type { SimulatedBhsStationTransport } from "./bhsStationTransport";

export interface BhsPlcSimulatorScenario {
  duplicateCount?: number;
  burstCount?: number;
}

/** Software-only PLC boundary. It emits frames exclusively through the transport. */
export class BhsPlcSimulator {
  constructor(private readonly transport: SimulatedBhsStationTransport) {}

  async send(message: BhsBagMessageV1, scenario: BhsPlcSimulatorScenario = {}) {
    const frame = encodeBhsWireMessage2001(message);
    const count = Math.max(1, scenario.burstCount ?? scenario.duplicateCount ?? 1);
    const results = [];
    for (let index = 0; index < count; index += 1) {
      results.push(await this.transport.emitFrame(frame));
    }
    return results;
  }

  disconnect() {
    this.transport.disconnect();
  }

  reconnect() {
    this.transport.reconnect();
  }

  failAcknowledgements(enabled = true) {
    this.transport.faults.acknowledgementWriteFails = enabled;
  }
}
