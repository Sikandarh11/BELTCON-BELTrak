import { Buffer } from "node:buffer";

import type { TaggingDeviceHealth } from "@/types/taggingWorkflow";

export interface BagPhotoCaptureRequest {
  sessionId: string;
  bagId: string;
  bhsUid: string;
  maximumBytes: number;
  suppliedBytes?: Uint8Array;
  suppliedMimeType?: "image/jpeg" | "image/png";
}

export interface CapturedBagPhoto {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  capturedAt: string;
  simulated: boolean;
}

export interface BagCameraAdapter {
  start(signal: AbortSignal): Promise<void>;
  capture(request: BagPhotoCaptureRequest, signal: AbortSignal): Promise<CapturedBagPhoto>;
  stop(): Promise<void>;
  getHealth(): Promise<TaggingDeviceHealth>;
}

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

abstract class BaseBagCameraAdapter implements BagCameraAdapter {
  protected started = false;
  constructor(
    protected readonly logicalDeviceId: string,
    protected readonly simulated: boolean,
  ) {}
  async start(signal: AbortSignal) {
    if (this.started) return;
    if (signal.aborted) throw new Error("BAG_CAMERA_START_CANCELLED");
    this.started = true;
  }
  async stop() {
    this.started = false;
  }
  abstract capture(request: BagPhotoCaptureRequest, signal: AbortSignal): Promise<CapturedBagPhoto>;
  async getHealth(): Promise<TaggingDeviceHealth> {
    return {
      state: this.started ? "READY" : "STOPPED",
      code: null,
      logicalDeviceId: this.logicalDeviceId,
      simulated: this.simulated,
    };
  }
}

export class SimulatedBagCameraAdapter extends BaseBagCameraAdapter {
  private failureCode: string | null = null;
  constructor(logicalDeviceId = "SIMULATED-BAG-CAMERA") {
    super(logicalDeviceId, true);
  }
  failNextCapture(code: string) {
    this.failureCode = code;
  }
  async capture(request: BagPhotoCaptureRequest, signal: AbortSignal): Promise<CapturedBagPhoto> {
    if (!this.started) throw new Error("BAG_CAMERA_UNAVAILABLE");
    if (signal.aborted) throw new Error("BAG_CAMERA_CAPTURE_CANCELLED");
    const failure = this.failureCode;
    this.failureCode = null;
    if (failure) throw new Error(failure);
    if (ONE_PIXEL_PNG.byteLength > request.maximumBytes) throw new Error("BAG_PHOTO_TOO_LARGE");
    return {
      bytes: Uint8Array.from(ONE_PIXEL_PNG),
      mimeType: "image/png",
      width: 1,
      height: 1,
      capturedAt: new Date().toISOString(),
      simulated: true,
    };
  }
}

export class FileUploadBagCameraAdapter extends BaseBagCameraAdapter {
  constructor(
    private readonly enabledForDevelopment: boolean,
    logicalDeviceId = "DEVELOPMENT-FILE-UPLOAD",
  ) {
    super(logicalDeviceId, true);
  }
  async capture(request: BagPhotoCaptureRequest, signal: AbortSignal): Promise<CapturedBagPhoto> {
    if (!this.enabledForDevelopment) throw new Error("BAG_CAMERA_FILE_UPLOAD_DISABLED");
    if (!this.started) throw new Error("BAG_CAMERA_UNAVAILABLE");
    if (signal.aborted) throw new Error("BAG_CAMERA_CAPTURE_CANCELLED");
    if (!request.suppliedBytes || !request.suppliedMimeType)
      throw new Error("BAG_PHOTO_FILE_REQUIRED");
    if (request.suppliedBytes.byteLength > request.maximumBytes)
      throw new Error("BAG_PHOTO_TOO_LARGE");
    return {
      bytes: Uint8Array.from(request.suppliedBytes),
      mimeType: request.suppliedMimeType,
      width: 1,
      height: 1,
      capturedAt: new Date().toISOString(),
      simulated: true,
    };
  }
}

export class UnavailablePhysicalBagCameraAdapter implements BagCameraAdapter {
  constructor(private readonly logicalDeviceId = "UNCONFIGURED-PHYSICAL-BAG-CAMERA") {}
  async start(_signal: AbortSignal) {
    throw new Error("BAG_CAMERA_UNAVAILABLE");
  }
  async capture(_request: BagPhotoCaptureRequest, _signal: AbortSignal): Promise<CapturedBagPhoto> {
    throw new Error("BAG_CAMERA_UNAVAILABLE");
  }
  async stop() {}
  async getHealth(): Promise<TaggingDeviceHealth> {
    return {
      state: "UNAVAILABLE",
      code: "BAG_CAMERA_UNAVAILABLE",
      logicalDeviceId: this.logicalDeviceId,
      simulated: false,
    };
  }
}

/** Webcam/vendor SDK support remains a deliberately unavailable shell. */
export class VendorBagCameraShell extends UnavailablePhysicalBagCameraAdapter {}
