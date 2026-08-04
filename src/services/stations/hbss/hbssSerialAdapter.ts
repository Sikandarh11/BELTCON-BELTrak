export const REQUIRED_HBSS_SERIAL_CONFIGURATION = Object.freeze({
  encoding: "ASCII" as const,
  baudRate: 9600 as const,
  parity: "EVEN" as const,
  dataBits: 8 as const,
  stopBits: 1 as const,
  flowControl: "NONE" as const,
});

export interface HbssSerialConfiguration {
  binding: string;
  encoding: "ASCII";
  baudRate: 9600;
  parity: "EVEN";
  dataBits: 8;
  stopBits: 1;
  flowControl: "NONE";
}

export interface HbssSerialHealth {
  state: "ONLINE" | "OFFLINE" | "DEGRADED" | "MISCONFIGURED" | "STOPPED";
  binding: string;
  detail?: string;
}

export interface HbssSerialWriteResult {
  bytesWritten: number;
  completedAt: string;
  errorCode?: string;
}

export interface HbssSerialAdapter {
  open(signal?: AbortSignal): Promise<void>;
  write(bytes: Uint8Array, signal?: AbortSignal): Promise<HbssSerialWriteResult>;
  close(): Promise<void>;
  getHealth(): Promise<HbssSerialHealth>;
}

export class HbssSerialError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface VirtualSerialFaults {
  portUnavailable: boolean;
  openNeverCompletes: boolean;
  writeNeverCompletes: boolean;
  partialWriteBytes: number | null;
  corruptBytes: boolean;
  disconnectAfterWrite: boolean;
}

export class VirtualHbssSerialAdapter implements HbssSerialAdapter {
  private openState = false;
  readonly sink: Uint8Array[] = [];
  readonly faults: VirtualSerialFaults = {
    portUnavailable: false,
    openNeverCompletes: false,
    writeNeverCompletes: false,
    partialWriteBytes: null,
    corruptBytes: false,
    disconnectAfterWrite: false,
  };

  constructor(readonly configuration: HbssSerialConfiguration) {}

  async open(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new HbssSerialError("Open cancelled", "CANCELLED");
    if (this.faults.portUnavailable) {
      throw new HbssSerialError(
        "Virtual serial port is unavailable",
        "HBSS_SERIAL_PORT_UNAVAILABLE",
      );
    }
    if (this.faults.openNeverCompletes) return new Promise<void>(() => undefined);
    this.openState = true;
  }

  async write(bytes: Uint8Array, signal?: AbortSignal) {
    if (!this.openState) {
      throw new HbssSerialError("Virtual serial port is not open", "HBSS_SERIAL_PORT_NOT_OPEN");
    }
    if (signal?.aborted) throw signal.reason ?? new HbssSerialError("Write cancelled", "CANCELLED");
    if (this.faults.writeNeverCompletes) {
      return new Promise<HbssSerialWriteResult>(() => undefined);
    }
    const requested = Uint8Array.from(bytes);
    const length = Math.max(
      0,
      Math.min(this.faults.partialWriteBytes ?? requested.byteLength, requested.byteLength),
    );
    const emitted = requested.slice(0, length);
    if (this.faults.corruptBytes && emitted.length > 0) emitted[0] ^= 0xff;
    this.sink.push(emitted);
    if (this.faults.disconnectAfterWrite) this.openState = false;
    return {
      bytesWritten: length,
      completedAt: new Date().toISOString(),
      ...(this.faults.corruptBytes ? { errorCode: "HBSS_SIMULATED_CORRUPTED_BYTES" } : {}),
    };
  }

  async close() {
    this.openState = false;
  }

  async getHealth(): Promise<HbssSerialHealth> {
    if (this.faults.portUnavailable) {
      return {
        state: "OFFLINE",
        binding: this.configuration.binding,
        detail: "HBSS_SERIAL_PORT_UNAVAILABLE",
      };
    }
    return {
      state: this.openState ? "ONLINE" : "STOPPED",
      binding: this.configuration.binding,
    };
  }

  reset() {
    this.sink.length = 0;
    Object.assign(this.faults, {
      portUnavailable: false,
      openNeverCompletes: false,
      writeNeverCompletes: false,
      partialWriteBytes: null,
      corruptBytes: false,
      disconnectAfterWrite: false,
    });
    this.openState = false;
  }
}

export class LoopbackHbssSerialAdapter extends VirtualHbssSerialAdapter {}

/** Explicitly unavailable: no COM-port library, cable or Smiths workstation is present. */
export class PhysicalRs232Adapter implements HbssSerialAdapter {
  constructor(private readonly binding: string) {}

  async open(): Promise<void> {
    throw new HbssSerialError(
      "Physical RS-232 adapter is unavailable",
      "HBSS_RS232_ADAPTER_UNAVAILABLE",
    );
  }

  async write(): Promise<HbssSerialWriteResult> {
    throw new HbssSerialError(
      "Physical RS-232 adapter is unavailable",
      "HBSS_RS232_ADAPTER_UNAVAILABLE",
    );
  }

  async close() {}

  async getHealth(): Promise<HbssSerialHealth> {
    return {
      state: "MISCONFIGURED",
      binding: this.binding,
      detail: "HBSS_RS232_ADAPTER_UNAVAILABLE",
    };
  }
}
