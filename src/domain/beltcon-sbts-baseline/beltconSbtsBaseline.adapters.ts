import { HbssRecallRequestSchema } from "./beltconSbtsBaseline.schemas";
import type {
  HbssRecallAdapter,
  HbssRecallRequest,
  HbssRecallResult,
} from "./beltconSbtsBaseline.types";

/** Safe development boundary; it performs no network, serial, or hardware I/O. */
export class SimulatedHbssRecallAdapter implements HbssRecallAdapter {
  async recall(request: HbssRecallRequest): Promise<HbssRecallResult> {
    const validated = HbssRecallRequestSchema.parse(request);
    return {
      status: "SIMULATED",
      requestedAt: validated.requestedAt,
      completedAt: validated.requestedAt,
      message: "HBSS recall was simulated; no workstation or serial device was contacted.",
    };
  }
}

/**
 * Explicitly disabled placeholder for the future RS-232 integration. It never
 * opens a port and must not be treated as a connected vendor adapter.
 */
export class Rs232HbssRecallAdapter implements HbssRecallAdapter {
  async recall(request: HbssRecallRequest): Promise<HbssRecallResult> {
    const validated = HbssRecallRequestSchema.parse(request);
    return {
      status: "UNAVAILABLE",
      requestedAt: validated.requestedAt,
      message: "RS-232 HBSS recall is not implemented or enabled.",
    };
  }
}
