import type { BhsWireAcknowledgement2002 } from "./bhsWireCodec";
import { encodeBhsWireAcknowledgement2002Payload } from "./bhsWireCodec";

export type BhsTransportHealthState =
  | "STARTING"
  | "ONLINE"
  | "DEGRADED"
  | "OFFLINE"
  | "MISCONFIGURED"
  | "STOPPED";

export interface TransportHealth {
  state: BhsTransportHealthState;
  detail?: string;
  changedAt: string;
}

export interface TransportWriteResult {
  status: "SENT" | "FAILED";
  bytesWritten: number;
  completedAt: string;
  errorCode?: string;
}

export type Unsubscribe = () => void;
export type BhsBagMessageHandler = (frame: Uint8Array) => void | Promise<void>;

export interface BhsStationTransport {
  start(signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  onBagMessage(handler: BhsBagMessageHandler): Unsubscribe;
  sendAcknowledgement(message: BhsWireAcknowledgement2002): Promise<TransportWriteResult>;
  getHealth(): Promise<TransportHealth>;
}

export interface SimulatedBhsTransportFaults {
  acknowledgementWriteFails: boolean;
  acknowledgementDelayMs: number;
}

export class BhsTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class SimulatedBhsStationTransport implements BhsStationTransport {
  protected state: BhsTransportHealthState = "STOPPED";
  protected changedAt = new Date().toISOString();
  protected detail: string | undefined;
  protected readonly handlers = new Set<BhsBagMessageHandler>();
  protected abortSignal: AbortSignal | null = null;
  readonly acknowledgements: Array<{
    message: BhsWireAcknowledgement2002;
    payload: Uint8Array;
  }> = [];
  readonly faults: SimulatedBhsTransportFaults = {
    acknowledgementWriteFails: false,
    acknowledgementDelayMs: 0,
  };

  protected setHealth(state: BhsTransportHealthState, detail?: string) {
    this.state = state;
    this.detail = detail;
    this.changedAt = new Date().toISOString();
  }

  async start(signal: AbortSignal) {
    if (this.state === "ONLINE") return;
    if (signal.aborted) {
      this.setHealth("STOPPED", "Start was cancelled");
      throw new BhsTransportError("Transport start was cancelled", "BHS_TRANSPORT_CANCELLED");
    }
    this.setHealth("STARTING");
    this.abortSignal = signal;
    signal.addEventListener(
      "abort",
      () => {
        this.setHealth("STOPPED", "Receive cancelled by shutdown");
      },
      { once: true },
    );
    this.setHealth("ONLINE");
  }

  async stop() {
    if (this.state === "STOPPED") return;
    this.setHealth("STOPPED");
    this.abortSignal = null;
  }

  onBagMessage(handler: BhsBagMessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendAcknowledgement(message: BhsWireAcknowledgement2002) {
    if (this.state !== "ONLINE") {
      return {
        status: "FAILED" as const,
        bytesWritten: 0,
        completedAt: new Date().toISOString(),
        errorCode: "BHS_TRANSPORT_OFFLINE",
      };
    }
    const payload = encodeBhsWireAcknowledgement2002Payload(message);
    if (this.faults.acknowledgementDelayMs > 0) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, this.faults.acknowledgementDelayMs),
      );
    }
    if (this.faults.acknowledgementWriteFails) {
      this.setHealth("DEGRADED", "Simulated acknowledgement write failure");
      return {
        status: "FAILED" as const,
        bytesWritten: 0,
        completedAt: new Date().toISOString(),
        errorCode: "BHS_ACK_WRITE_FAILED",
      };
    }
    this.acknowledgements.push({ message: { ...message }, payload });
    return {
      status: "SENT" as const,
      bytesWritten: payload.byteLength,
      completedAt: new Date().toISOString(),
    };
  }

  async getHealth(): Promise<TransportHealth> {
    return { state: this.state, detail: this.detail, changedAt: this.changedAt };
  }

  async emitFrame(frame: Uint8Array) {
    if (this.state !== "ONLINE") {
      throw new BhsTransportError(
        "BHS transport cannot receive while stopped",
        "BHS_TRANSPORT_OFFLINE",
      );
    }
    const errors: unknown[] = [];
    for (const handler of this.handlers) {
      try {
        await handler(Uint8Array.from(frame));
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      this.setHealth("DEGRADED", "One or more station message handlers failed");
    }
    return { delivered: this.handlers.size, handlerErrors: errors.length };
  }

  disconnect() {
    this.setHealth("OFFLINE", "Simulated transport disconnect");
  }

  reconnect() {
    if (this.abortSignal?.aborted) {
      throw new BhsTransportError(
        "Transport shutdown has been requested",
        "BHS_TRANSPORT_CANCELLED",
      );
    }
    this.setHealth("ONLINE");
  }
}

export class LoopbackBhsStationTransport extends SimulatedBhsStationTransport {
  private readonly acknowledgementHandlers = new Set<
    (message: BhsWireAcknowledgement2002, payload: Uint8Array) => void | Promise<void>
  >();

  onAcknowledgement(
    handler: (message: BhsWireAcknowledgement2002, payload: Uint8Array) => void | Promise<void>,
  ) {
    this.acknowledgementHandlers.add(handler);
    return () => this.acknowledgementHandlers.delete(handler);
  }

  override async sendAcknowledgement(message: BhsWireAcknowledgement2002) {
    const result = await super.sendAcknowledgement(message);
    if (result.status === "SENT") {
      const payload = this.acknowledgements.at(-1)?.payload;
      if (payload) {
        for (const handler of this.acknowledgementHandlers) await handler(message, payload);
      }
    }
    return result;
  }
}

/** Explicitly unavailable until an approved gateway SDK, GSD mapping and hardware exist. */
export class ProfinetBhsStationTransport implements BhsStationTransport {
  private changedAt = new Date().toISOString();

  async start(): Promise<void> {
    this.changedAt = new Date().toISOString();
    throw new BhsTransportError(
      "Profinet station transport is unavailable",
      "PROFINET_ADAPTER_UNAVAILABLE",
    );
  }

  async stop() {}

  onBagMessage() {
    return () => undefined;
  }

  async sendAcknowledgement(): Promise<TransportWriteResult> {
    return {
      status: "FAILED",
      bytesWritten: 0,
      completedAt: new Date().toISOString(),
      errorCode: "PROFINET_ADAPTER_UNAVAILABLE",
    };
  }

  async getHealth(): Promise<TransportHealth> {
    return {
      state: "MISCONFIGURED",
      detail: "PROFINET_ADAPTER_UNAVAILABLE",
      changedAt: this.changedAt,
    };
  }
}
