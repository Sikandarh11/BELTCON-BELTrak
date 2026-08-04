import "@tanstack/react-start/server-only";

import { BhsUidSchema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import type { RecheckStationConfig } from "../stationConfig";
import { sanitizeIntegrationError } from "../integrationHarnessSecurity";
import type { BarcodeInputAdapter, BarcodeScan } from "./barcodeInputAdapter";
import { encodeHbssBidRequest } from "./hbssBidCodec";
import { HbssSerialError, type HbssSerialAdapter } from "./hbssSerialAdapter";
import type {
  LocalRecallRequest,
  RecheckStationRepository,
} from "./recheckStationRepository.server";

export interface RecheckBagLookup {
  bagId: string;
  bhsUid: string;
  rfidTagBarcode: string | null;
  status: string;
  assignedRecheckStationId?: string | null;
}

export interface RecheckCentralClient {
  findByExactTag(barcode: string): Promise<RecheckBagLookup | null>;
}

export type RecheckStationActor = {
  id: string;
  permissions: ReadonlySet<"bag.recheck" | "station.recall.retry">;
};

export interface RecallRequestResult {
  request: LocalRecallRequest;
  duplicate: boolean;
  operatorFeedbackTimeoutMs: number;
}

interface TimeoutHandle {
  cancel(): void;
  promise: Promise<never>;
}

export interface StationTimer {
  createTimeout(milliseconds: number, code: string): TimeoutHandle;
}

const defaultTimer: StationTimer = {
  createTimeout(milliseconds, code) {
    let handle: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_, reject) => {
      handle = setTimeout(
        () => reject(new HbssSerialError("Station command timed out", code)),
        milliseconds,
      );
    });
    return { promise, cancel: () => clearTimeout(handle) };
  },
};

export function isHbssErrorDialogVisible(
  failedAt: number,
  now: number,
  timeoutMilliseconds: number,
) {
  return now - failedAt < timeoutMilliseconds;
}

export interface RecheckStationAgentDependencies {
  config: RecheckStationConfig;
  serialAdapter: HbssSerialAdapter;
  barcodeAdapter: BarcodeInputAdapter;
  repository: RecheckStationRepository;
  centralClient: RecheckCentralClient;
  timer?: StationTimer;
}

export class RecheckStationAgent {
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private readonly active = new Map<string, AbortController>();
  private readonly recentScans = new Map<string, number>();
  private readonly timer: StationTimer;

  constructor(private readonly dependencies: RecheckStationAgentDependencies) {
    this.timer = dependencies.timer ?? defaultTimer;
  }

  async start() {
    if (this.started) return;
    await this.dependencies.repository.recoverAfterRestart();
    this.unsubscribe = this.dependencies.barcodeAdapter.onScan(async (scan) => {
      await this.handleScan(scan, {
        id: "BARCODE_INPUT",
        permissions: new Set(["bag.recheck"]),
      });
    });
    await this.dependencies.barcodeAdapter.start();
    this.started = true;
  }

  async stop() {
    if (!this.started) return;
    for (const controller of this.active.values()) controller.abort(new Error("STATION_STOPPED"));
    this.active.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.dependencies.barcodeAdapter.stop();
    await this.dependencies.serialAdapter.close();
    this.started = false;
  }

  private async withTimeout<T>(operation: Promise<T>, code: string) {
    const timeout = this.timer.createTimeout(this.dependencies.config.errorDialogTimeoutMs, code);
    try {
      return await Promise.race([operation, timeout.promise]);
    } finally {
      timeout.cancel();
    }
  }

  private exactBarcode(scan: BarcodeScan) {
    if (!scan.value || scan.value !== scan.value.trim()) throw new Error("RFID_BARCODE_INVALID");
    if ([...scan.value].some((character) => character.charCodeAt(0) < 0x20)) {
      throw new Error("RFID_BARCODE_INVALID");
    }
    return scan.value;
  }

  async handleScan(
    scan: BarcodeScan,
    actor: RecheckStationActor,
  ): Promise<RecallRequestResult | null> {
    if (!actor.permissions.has("bag.recheck")) throw new Error("RECHECK_STATION_UNAUTHORIZED");
    const barcode = this.exactBarcode(scan);
    const now = Date.now();
    const recent = this.recentScans.get(barcode);
    if (recent !== undefined && now - recent < this.dependencies.config.duplicateScanDebounceMs) {
      return null;
    }
    this.recentScans.set(barcode, now);
    return this.requestRecall({
      requestId: crypto.randomUUID(),
      barcode,
      rawBarcode: scan.raw,
      actor,
    });
  }

  async requestRecall(input: {
    requestId: string;
    barcode: string;
    rawBarcode?: string;
    actor: RecheckStationActor;
  }): Promise<RecallRequestResult> {
    if (!input.actor.permissions.has("bag.recheck")) {
      throw new Error("RECHECK_STATION_UNAUTHORIZED");
    }
    const lookup = await this.dependencies.centralClient.findByExactTag(input.barcode);
    if (!lookup) throw new Error("RECHECK_CASE_NOT_FOUND");
    if (lookup.rfidTagBarcode !== input.barcode)
      throw new Error("RFID_BARCODE_EXACT_MATCH_REQUIRED");
    if (lookup.status === "RESOLVED" || lookup.status === "CLOSED") {
      throw new Error("RECHECK_BAG_CLOSED");
    }
    if (
      lookup.assignedRecheckStationId &&
      lookup.assignedRecheckStationId !== this.dependencies.config.stationId
    ) {
      throw new Error("RECHECK_STATION_BINDING_MISMATCH");
    }

    const created = await this.dependencies.repository.create({
      requestId: input.requestId,
      stationId: this.dependencies.config.stationId,
      siteId: this.dependencies.config.siteId,
      bagId: lookup.bagId,
      bhsUid: lookup.bhsUid,
      barcode: input.barcode,
      rawBarcode: input.rawBarcode ?? input.barcode,
      framingProfile: this.dependencies.config.framingProfile,
    });
    if (created.duplicate) {
      return {
        request: created.request,
        duplicate: true,
        operatorFeedbackTimeoutMs: this.dependencies.config.errorDialogTimeoutMs,
      };
    }
    const request = await this.execute(created.request);
    return {
      request,
      duplicate: false,
      operatorFeedbackTimeoutMs: this.dependencies.config.errorDialogTimeoutMs,
    };
  }

  private async execute(initial: LocalRecallRequest) {
    const controller = new AbortController();
    this.active.set(initial.requestId, controller);
    let request = initial;
    try {
      request = await this.dependencies.repository.transition(request.requestId, "VALIDATING");
      const bhsUid = BhsUidSchema.parse(request.bhsUid);
      const bytes = encodeHbssBidRequest(bhsUid, request.framingProfile);
      request = await this.dependencies.repository.transition(request.requestId, "READY_TO_SEND", {
        encodedBytes: bytes,
      });
      request = await this.dependencies.repository.transition(request.requestId, "OPENING_PORT");
      await this.withTimeout(
        this.dependencies.serialAdapter.open(controller.signal),
        "HBSS_SERIAL_OPEN_TIMED_OUT",
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      request = await this.dependencies.repository.transition(request.requestId, "WRITING");
      const write = await this.withTimeout(
        this.dependencies.serialAdapter.write(bytes, controller.signal),
        "HBSS_SERIAL_WRITE_TIMED_OUT",
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      if (write.errorCode)
        throw new HbssSerialError("Serial output was corrupted", write.errorCode);
      if (write.bytesWritten !== bytes.byteLength) {
        throw new HbssSerialError("Serial output was incomplete", "HBSS_SERIAL_PARTIAL_WRITE");
      }
      request = await this.dependencies.repository.transition(request.requestId, "REQUEST_SENT");
      return request;
    } catch (error) {
      const current = await this.dependencies.repository.get(initial.requestId);
      if (!current) throw error;
      if (
        ["REQUEST_SENT", "TIMED_OUT", "FAILED", "UNAVAILABLE", "CANCELLED"].includes(current.state)
      ) {
        return current;
      }
      const code = error instanceof HbssSerialError ? error.code : sanitizeIntegrationError(error);
      const state = controller.signal.aborted
        ? "CANCELLED"
        : code.includes("TIMED_OUT")
          ? "TIMED_OUT"
          : code === "HBSS_SERIAL_PORT_UNAVAILABLE" || code === "HBSS_RS232_ADAPTER_UNAVAILABLE"
            ? "UNAVAILABLE"
            : "FAILED";
      return this.dependencies.repository.transition(current.requestId, state, {
        errorCode: code,
        errorMessage: sanitizeIntegrationError(error),
      });
    } finally {
      this.active.delete(initial.requestId);
      await this.dependencies.serialAdapter.close();
    }
  }

  async cancel(requestId: string, actor: RecheckStationActor) {
    if (!actor.permissions.has("bag.recheck")) throw new Error("RECHECK_STATION_UNAUTHORIZED");
    const controller = this.active.get(requestId);
    controller?.abort(new Error("HBSS_RECALL_CANCELLED"));
    const request = await this.dependencies.repository.get(requestId);
    if (!request) throw new Error("HBSS_RECALL_REQUEST_NOT_FOUND");
    if (
      ["REQUEST_SENT", "FAILED", "TIMED_OUT", "UNAVAILABLE", "CANCELLED"].includes(request.state)
    ) {
      return request;
    }
    return this.dependencies.repository.transition(requestId, "CANCELLED", {
      errorCode: "HBSS_RECALL_CANCELLED",
      errorMessage: "Recall was cancelled by the operator",
    });
  }

  async retry(requestId: string, actor: RecheckStationActor) {
    if (!actor.permissions.has("station.recall.retry")) {
      throw new Error("RECHECK_RETRY_UNAUTHORIZED");
    }
    let request = await this.dependencies.repository.get(requestId);
    if (!request) throw new Error("HBSS_RECALL_REQUEST_NOT_FOUND");
    request = await this.dependencies.repository.transition(requestId, "RETRY_PENDING");
    return this.execute(request);
  }

  async getHealth() {
    return {
      state: this.started ? "ONLINE" : "STOPPED",
      serial: await this.dependencies.serialAdapter.getHealth(),
      requests: await this.dependencies.repository.list(),
    };
  }
}
