export type BarcodeScanKind = "SCANNER" | "MANUAL" | "SIMULATED";
export interface BarcodeScan {
  value: string;
  raw: string;
  kind: BarcodeScanKind;
  scannedAt: string;
}
export type BarcodeHandler = (scan: BarcodeScan) => void | Promise<void>;

export interface BarcodeInputAdapter {
  onScan(handler: BarcodeHandler): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

abstract class BaseBarcodeInputAdapter implements BarcodeInputAdapter {
  protected readonly handlers = new Set<BarcodeHandler>();
  protected started = false;

  onScan(handler: BarcodeHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start() {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  protected async publish(scan: BarcodeScan) {
    for (const handler of this.handlers) await handler(scan);
  }
}

export class SimulatedBarcodeInputAdapter extends BaseBarcodeInputAdapter {
  async scan(value: string) {
    if (!this.started) throw new Error("BARCODE_SCANNER_DISCONNECTED");
    if (!value) throw new Error("BARCODE_SCAN_INCOMPLETE");
    await this.publish({
      value,
      raw: value,
      kind: "SIMULATED",
      scannedAt: new Date().toISOString(),
    });
  }
}

export interface KeyboardWedgeOptions {
  terminators: ReadonlySet<"Enter" | "Tab">;
  maximumScannerInterKeyMs: number;
  target?: EventTarget | null;
  now?: () => number;
}

/** Browser-compatible keyboard-wedge collector; it does not perform bag lookup. */
export class KeyboardWedgeBarcodeInputAdapter extends BaseBarcodeInputAdapter {
  private buffer = "";
  private raw = "";
  private lastKeyAt: number | null = null;
  private manual = false;
  private readonly now: () => number;
  private readonly listener = (event: Event) => {
    if (typeof KeyboardEvent !== "undefined" && event instanceof KeyboardEvent) {
      void this.feedKey(event.key, this.now());
    }
  };

  constructor(private readonly options: KeyboardWedgeOptions) {
    super();
    this.now = options.now ?? (() => Date.now());
  }

  override async start() {
    await super.start();
    this.options.target?.addEventListener("keydown", this.listener);
  }

  override async stop() {
    this.options.target?.removeEventListener("keydown", this.listener);
    this.reset();
    await super.stop();
  }

  private reset() {
    this.buffer = "";
    this.raw = "";
    this.lastKeyAt = null;
    this.manual = false;
  }

  async feedKey(key: string, at = this.now()) {
    if (!this.started) throw new Error("BARCODE_SCANNER_DISCONNECTED");
    if (this.options.terminators.has(key as "Enter" | "Tab")) {
      const value = this.buffer;
      const raw = `${this.raw}${key === "Enter" ? "\r" : "\t"}`;
      const kind: BarcodeScanKind = this.manual ? "MANUAL" : "SCANNER";
      this.reset();
      if (!value) throw new Error("BARCODE_SCAN_INCOMPLETE");
      await this.publish({ value, raw, kind, scannedAt: new Date(at).toISOString() });
      return;
    }
    if (key.length !== 1 || key.charCodeAt(0) < 0x20 || key.charCodeAt(0) > 0x7e) return;
    if (this.lastKeyAt !== null && at - this.lastKeyAt > this.options.maximumScannerInterKeyMs) {
      this.manual = true;
    }
    this.buffer += key;
    this.raw += key;
    this.lastKeyAt = at;
  }
}
