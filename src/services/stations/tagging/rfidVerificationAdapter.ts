import type { TagVerificationResult, TaggingDeviceHealth } from "@/types/taggingWorkflow";

export interface RfidVerificationRequest {
  sessionId: string;
  expectedEpc: string;
  barcode: string | null;
  logicalDeviceId: string;
  timeoutMs: number;
  requiredStableReadCount: number;
}

export interface RfidVerificationResult {
  result: TagVerificationResult;
  expectedEpc: string;
  observedEpcs: string[];
  stableReadCount: number;
  failureCode: string | null;
  simulated: boolean;
}

export interface RfidVerificationAdapter {
  verify(request: RfidVerificationRequest, signal: AbortSignal): Promise<RfidVerificationResult>;
  getHealth(): Promise<TaggingDeviceHealth>;
}

export class SimulatedRfidVerificationAdapter implements RfidVerificationAdapter {
  private nextResult: Omit<RfidVerificationResult, "expectedEpc" | "simulated"> | null = null;

  constructor(private readonly logicalDeviceId = "SIMULATED-RFID-VERIFIER") {}

  setNextResult(result: Omit<RfidVerificationResult, "expectedEpc" | "simulated">) {
    this.nextResult = structuredClone(result);
  }

  async verify(
    request: RfidVerificationRequest,
    signal: AbortSignal,
  ): Promise<RfidVerificationResult> {
    if (signal.aborted) {
      return {
        result: "CANCELLED",
        expectedEpc: request.expectedEpc,
        observedEpcs: [],
        stableReadCount: 0,
        failureCode: "RFID_VERIFY_CANCELLED",
        simulated: true,
      };
    }
    const configured = this.nextResult;
    this.nextResult = null;
    if (configured) return { ...configured, expectedEpc: request.expectedEpc, simulated: true };
    return {
      result: "VERIFIED",
      expectedEpc: request.expectedEpc,
      observedEpcs: Array.from(
        { length: request.requiredStableReadCount },
        () => request.expectedEpc,
      ),
      stableReadCount: request.requiredStableReadCount,
      failureCode: null,
      simulated: true,
    };
  }

  async getHealth(): Promise<TaggingDeviceHealth> {
    return { state: "READY", code: null, logicalDeviceId: this.logicalDeviceId, simulated: true };
  }
}

export class UnavailablePhysicalRfidVerificationAdapter implements RfidVerificationAdapter {
  constructor(private readonly logicalDeviceId = "UNCONFIGURED-PHYSICAL-RFID-VERIFIER") {}
  async verify(request: RfidVerificationRequest): Promise<RfidVerificationResult> {
    return {
      result: "DEVICE_UNAVAILABLE",
      expectedEpc: request.expectedEpc,
      observedEpcs: [],
      stableReadCount: 0,
      failureCode: "RFID_VERIFIER_UNAVAILABLE",
      simulated: false,
    };
  }
  async getHealth(): Promise<TaggingDeviceHealth> {
    return {
      state: "UNAVAILABLE",
      code: "RFID_VERIFIER_UNAVAILABLE",
      logicalDeviceId: this.logicalDeviceId,
      simulated: false,
    };
  }
}

/** Vendor reader/encoder verification remains an unavailable contract shell. */
export class VendorRfidVerificationShell extends UnavailablePhysicalRfidVerificationAdapter {}
