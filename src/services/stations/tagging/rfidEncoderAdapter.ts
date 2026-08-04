import type { TaggingDeviceHealth } from "@/types/taggingWorkflow";

export interface RfidEncodeRequest {
  jobId: string;
  sessionId: string;
  epc: string;
  barcode: string | null;
  labelTemplateId: string | null;
  logicalDeviceId: string;
}

export interface RfidEncodeResult {
  status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "AMBIGUOUS";
  jobId: string;
  failureCode: string | null;
  metadata: Record<string, string | number | boolean | null>;
  simulated: boolean;
}

export interface RfidEncoderAdapter {
  encode(request: RfidEncodeRequest, signal: AbortSignal): Promise<RfidEncodeResult>;
  cancel(jobId: string): Promise<void>;
  getHealth(): Promise<TaggingDeviceHealth>;
}

export class SimulatedRfidEncoderAdapter implements RfidEncoderAdapter {
  private readonly cancelled = new Set<string>();
  private nextResult: Omit<RfidEncodeResult, "jobId" | "simulated"> | null = null;

  constructor(private readonly logicalDeviceId = "SIMULATED-RFID-ENCODER") {}

  setNextResult(result: Omit<RfidEncodeResult, "jobId" | "simulated">) {
    this.nextResult = structuredClone(result);
  }

  async encode(request: RfidEncodeRequest, signal: AbortSignal): Promise<RfidEncodeResult> {
    if (signal.aborted || this.cancelled.has(request.jobId)) {
      return {
        status: "CANCELLED",
        jobId: request.jobId,
        failureCode: "RFID_ENCODE_CANCELLED",
        metadata: {},
        simulated: true,
      };
    }
    const configured = this.nextResult;
    this.nextResult = null;
    if (configured) return { ...configured, jobId: request.jobId, simulated: true };
    return {
      status: "SUCCEEDED",
      jobId: request.jobId,
      failureCode: null,
      metadata: { logicalDeviceId: this.logicalDeviceId, encodedEpc: request.epc },
      simulated: true,
    };
  }

  async cancel(jobId: string) {
    this.cancelled.add(jobId);
  }

  async getHealth(): Promise<TaggingDeviceHealth> {
    return { state: "READY", code: null, logicalDeviceId: this.logicalDeviceId, simulated: true };
  }
}

export class UnavailablePhysicalRfidEncoderAdapter implements RfidEncoderAdapter {
  constructor(private readonly logicalDeviceId = "UNCONFIGURED-PHYSICAL-RFID-ENCODER") {}
  async encode(request: RfidEncodeRequest): Promise<RfidEncodeResult> {
    return {
      status: "FAILED",
      jobId: request.jobId,
      failureCode: "RFID_ENCODER_UNAVAILABLE",
      metadata: {},
      simulated: false,
    };
  }
  async cancel(_jobId: string) {}
  async getHealth(): Promise<TaggingDeviceHealth> {
    return {
      state: "UNAVAILABLE",
      code: "RFID_ENCODER_UNAVAILABLE",
      logicalDeviceId: this.logicalDeviceId,
      simulated: false,
    };
  }
}

/** Vendor SDK/protocol deliberately absent until a controlled contract exists. */
export class VendorRfidEncoderShell extends UnavailablePhysicalRfidEncoderAdapter {}
