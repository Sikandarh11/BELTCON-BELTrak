import type { TagInputKind, TaggingDeviceHealth } from "@/types/taggingWorkflow";

export interface RfidBarcodeCapture {
  value: string;
  raw: string;
  kind: TagInputKind;
  capturedAt: string;
  simulated: boolean;
}

export type RfidBarcodeHandler = (capture: RfidBarcodeCapture) => void | Promise<void>;

export interface RfidTagInputAdapter {
  start(signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  onBarcode(handler: RfidBarcodeHandler): () => void;
  getHealth(): Promise<TaggingDeviceHealth>;
}

abstract class BaseRfidTagInputAdapter implements RfidTagInputAdapter {
  protected readonly handlers = new Set<RfidBarcodeHandler>();
  protected started = false;
  protected handlerFailure: string | null = null;
  private abortCleanup: (() => void) | null = null;

  constructor(
    protected readonly logicalDeviceId: string,
    protected readonly simulated: boolean,
  ) {}

  onBarcode(handler: RfidBarcodeHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(signal: AbortSignal) {
    if (this.started) return;
    if (signal.aborted) throw new Error("RFID_SCANNER_START_CANCELLED");
    const onAbort = () => void this.stop();
    signal.addEventListener("abort", onAbort, { once: true });
    this.abortCleanup = () => signal.removeEventListener("abort", onAbort);
    this.started = true;
  }

  async stop() {
    if (!this.started) return;
    this.abortCleanup?.();
    this.abortCleanup = null;
    this.started = false;
  }

  protected async publish(capture: RfidBarcodeCapture) {
    const results = await Promise.allSettled(
      [...this.handlers].map(async (handler) => handler({ ...capture })),
    );
    this.handlerFailure = results.some((result) => result.status === "rejected")
      ? "RFID_SCANNER_HANDLER_FAILED"
      : null;
  }

  async getHealth(): Promise<TaggingDeviceHealth> {
    return {
      state: this.started ? (this.handlerFailure ? "DEGRADED" : "READY") : "STOPPED",
      code: this.handlerFailure,
      logicalDeviceId: this.logicalDeviceId,
      simulated: this.simulated,
    };
  }
}

export class SimulatedRfidTagInputAdapter extends BaseRfidTagInputAdapter {
  constructor(logicalDeviceId = "SIMULATED-RFID-SCANNER") {
    super(logicalDeviceId, true);
  }

  async scan(value: string, at = new Date().toISOString()) {
    if (!this.started) throw new Error("RFID_SCANNER_UNAVAILABLE");
    await this.publish({
      value,
      raw: `${value}\r\n`,
      kind: "SIMULATED",
      capturedAt: at,
      simulated: true,
    });
  }
}

/**
 * Transport-neutral keyboard-wedge collector. A UI/desktop shell supplies key
 * events; no browser request can choose this adapter.
 */
export class KeyboardWedgeRfidTagInputAdapter extends BaseRfidTagInputAdapter {
  private buffer = "";
  private lastKeyAt: number | null = null;
  private manual = false;

  constructor(
    logicalDeviceId = "KEYBOARD-WEDGE-RFID-SCANNER",
    private readonly maximumScannerInterKeyMs = 100,
  ) {
    super(logicalDeviceId, false);
  }

  async feedKey(key: string, at = Date.now()) {
    if (!this.started) throw new Error("RFID_SCANNER_UNAVAILABLE");
    if (key === "Enter" || key === "Tab") {
      const value = this.buffer;
      const kind: TagInputKind = this.manual ? "MANUAL" : "SCANNER";
      this.buffer = "";
      this.lastKeyAt = null;
      this.manual = false;
      if (!value) throw new Error("RFID_SCANNER_PARTIAL_INPUT");
      await this.publish({
        value,
        raw: `${value}${key === "Enter" ? "\r" : "\t"}`,
        kind,
        capturedAt: new Date(at).toISOString(),
        simulated: false,
      });
      return;
    }
    if (key.length !== 1 || key.charCodeAt(0) < 0x20 || key.charCodeAt(0) > 0x7e) return;
    if (this.lastKeyAt !== null && at - this.lastKeyAt > this.maximumScannerInterKeyMs) {
      this.manual = true;
    }
    this.buffer += key;
    this.lastKeyAt = at;
  }

  override async stop() {
    this.buffer = "";
    this.lastKeyAt = null;
    this.manual = false;
    await super.stop();
  }
}

export class PhysicalBarcodeScannerAdapter implements RfidTagInputAdapter {
  constructor(private readonly logicalDeviceId = "UNCONFIGURED-PHYSICAL-RFID-SCANNER") {}
  onBarcode(_handler: RfidBarcodeHandler) {
    return () => undefined;
  }
  async start(_signal: AbortSignal) {
    throw new Error("RFID_SCANNER_UNAVAILABLE");
  }
  async stop() {}
  async getHealth(): Promise<TaggingDeviceHealth> {
    return {
      state: "UNAVAILABLE",
      code: "RFID_SCANNER_UNAVAILABLE",
      logicalDeviceId: this.logicalDeviceId,
      simulated: false,
    };
  }
}
