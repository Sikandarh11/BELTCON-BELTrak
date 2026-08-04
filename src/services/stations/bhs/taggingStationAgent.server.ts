import "@tanstack/react-start/server-only";

import { createBhsMessageFingerprint } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers";
import type { BhsBagMessageV1 } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types";
import type { TaggingStationConfig } from "../stationConfig";
import { sanitizeIntegrationError } from "../integrationHarnessSecurity";
import type { BhsStationTransport } from "./bhsStationTransport";
import {
  decodeBhsWireMessage2001,
  encodeBhsWireMessage2001,
  type BhsWireMessage2001,
} from "./bhsWireCodec";
import type {
  SaveInboundResult,
  StationInboxRepository,
  StationQueueState,
  StoredInboundMessage,
} from "./stationInboxRepository.server";

export interface BhsCentralIngestionResult {
  outcome: "ACCEPTED" | "DUPLICATE" | "REJECTED" | "FAILED";
  bagId: string | null;
  errorCode?: string | null;
}

export interface BhsCentralClient {
  ingest(
    message: BhsBagMessageV1,
    context: { stationId: string; siteId: string; sourceSystem: string; requestId: string },
  ): Promise<BhsCentralIngestionResult>;
  getHealth?(): Promise<{ healthy: boolean; detail?: string }>;
}

export class HttpBhsCentralClient implements BhsCentralClient {
  constructor(
    private readonly baseUrl: string,
    private readonly integrationKey: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async ingest(
    message: BhsBagMessageV1,
    context: { stationId: string; siteId: string; sourceSystem: string; requestId: string },
  ) {
    if (!this.integrationKey) throw new Error("BHS_STATION_CREDENTIAL_MISSING");
    const response = await this.fetchImplementation(
      new URL("/api/integrations/bhs/messages", this.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bhs-integration-key": this.integrationKey,
          "x-request-id": context.requestId,
          "x-sbts-station-id": context.stationId,
          "x-sbts-site-id": context.siteId,
          "x-sbts-source-system": context.sourceSystem,
        },
        body: JSON.stringify(message),
      },
    );
    const body = (await response.json()) as {
      result?: BhsCentralIngestionResult;
      code?: string;
    };
    if (!response.ok && !body.result) throw new Error(body.code ?? "BHS_CENTRAL_SYNC_FAILED");
    if (!body.result) throw new Error("BHS_CENTRAL_RESPONSE_INVALID");
    return body.result;
  }

  async getHealth() {
    try {
      const response = await this.fetchImplementation(
        new URL("/api/integrations/bhs/messages", this.baseUrl),
        { method: "OPTIONS" },
      );
      return { healthy: response.status < 500 };
    } catch (error) {
      return { healthy: false, detail: sanitizeIntegrationError(error) };
    }
  }
}

export type StationActor = {
  id: string;
  permissions: ReadonlySet<"bag.tag" | "station.jam.clear" | "station.sync.retry">;
};

export interface StationReceiveResult {
  outcome:
    | "ACCEPTED"
    | "NOT_QUEUED"
    | "DUPLICATE"
    | "QUEUE_CAPACITY_REACHED"
    | "MESSAGE_IDENTITY_CONFLICT"
    | "REJECTED"
    | "FAILED";
  inboundMessageId: string | null;
  queueItemId: string | null;
  acknowledgement: "DISABLED" | "SENT" | "PENDING" | "NOT_SENT";
  synchronization:
    | "SYNCED"
    | "DUPLICATE_CONFIRMED"
    | "CONFLICT"
    | "PERMANENT_FAILURE"
    | "PENDING"
    | "NOT_ATTEMPTED";
  errorCode: string | null;
}

export interface StationAgentHealth {
  state: "ONLINE" | "DEGRADED" | "OFFLINE" | "STOPPED" | "MISCONFIGURED";
  transport: Awaited<ReturnType<BhsStationTransport["getHealth"]>>;
  pendingAcknowledgements: number;
  pendingSynchronizations: number;
  queueOccupied: number;
  detail?: string;
}

export interface TaggingStationAgent {
  start(): Promise<void>;
  stop(): Promise<void>;
  receiveBhsMessage(message: Uint8Array | BhsBagMessageV1): Promise<StationReceiveResult>;
  getQueue(): Promise<StationQueueState>;
  startTagging(queueItemId: string, actor: StationActor): Promise<void>;
  bindTaggingSession(queueItemId: string, sessionId: string, actor: StationActor): Promise<void>;
  completeTagging(
    queueItemId: string,
    sessionId: string,
    assignmentId: string,
    actor: StationActor,
  ): Promise<void>;
  clearJammedBag(queueItemId: string, reason: string, actor: StationActor): Promise<void>;
  retrySynchronization(queueItemId: string | null, actor: StationActor): Promise<void>;
  retryAcknowledgements(): Promise<void>;
  getHealth(): Promise<StationAgentHealth>;
}

export interface TaggingStationAgentDependencies {
  config: TaggingStationConfig;
  transport: BhsStationTransport;
  repository: StationInboxRepository;
  centralClient: BhsCentralClient;
  now?: () => string;
}

export class DefaultTaggingStationAgent implements TaggingStationAgent {
  private readonly now: () => string;
  private readonly abortController = new AbortController();
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private lastError: string | undefined;

  constructor(private readonly dependencies: TaggingStationAgentDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async start() {
    if (this.started) return;
    this.unsubscribe = this.dependencies.transport.onBagMessage(async (frame) => {
      await this.receiveBhsMessage(frame);
    });
    try {
      await this.dependencies.transport.start(this.abortController.signal);
      this.started = true;
      await this.retryAcknowledgements();
      await this.synchronizePending();
      const retentionCutoff = new Date(
        Date.parse(this.now()) - this.dependencies.config.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      await this.dependencies.repository.cleanupRetained(retentionCutoff);
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.lastError = sanitizeIntegrationError(error);
      throw error;
    }
  }

  async stop() {
    if (!this.started && !this.unsubscribe) return;
    this.abortController.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.dependencies.transport.stop();
    this.started = false;
  }

  private async recordRejected(
    code: string,
    detail: string,
    rawFrame: Uint8Array,
    bhsUid?: string,
  ): Promise<StationReceiveResult> {
    await this.dependencies.repository.recordRejectedAttempt({
      stationId: this.dependencies.config.stationId,
      siteId: this.dependencies.config.siteId,
      code,
      detail,
      rawFrame,
      bhsUid,
    });
    return {
      outcome: "REJECTED",
      inboundMessageId: null,
      queueItemId: null,
      acknowledgement: "NOT_SENT",
      synchronization: "NOT_ATTEMPTED",
      errorCode: code,
    };
  }

  private acknowledgementAllowed(saved: SaveInboundResult) {
    if (!this.dependencies.config.acknowledgementEnabled) return false;
    if (saved.inbound.outcome === "MESSAGE_IDENTITY_CONFLICT") return false;
    if (saved.inbound.outcome === "QUEUE_CAPACITY_REACHED") {
      return this.dependencies.config.acknowledgeQueueCapacityReached;
    }
    return true;
  }

  private async acknowledge(inbound: StoredInboundMessage) {
    const configuredValue = this.dependencies.config.acknowledgementReceivedValue;
    if (configuredValue === null) throw new Error("BHS_ACK_VALUE_MISSING");
    const result = await this.dependencies.transport.sendAcknowledgement({
      messageType: 2002,
      ack: configuredValue,
      bhsUid: inbound.bhsUid,
      mappingStatus: this.dependencies.config.acknowledgementMappingStatus,
    });
    if (result.status !== "SENT") {
      await this.dependencies.repository.markAcknowledgementPending(
        inbound.id,
        result.errorCode ?? "BHS_ACK_WRITE_FAILED",
      );
      return false;
    }
    await this.dependencies.repository.markAcknowledged(inbound.id);
    return true;
  }

  private semanticFromStored(inbound: StoredInboundMessage): BhsBagMessageV1 {
    return {
      messageType: 2001,
      trigger: 1,
      lineId: inbound.lineId,
      bhsUid: inbound.bhsUid,
      evaluation: inbound.evaluation,
    };
  }

  private async synchronize(inbound: StoredInboundMessage) {
    try {
      const result = await this.dependencies.centralClient.ingest(
        this.semanticFromStored(inbound),
        {
          stationId: this.dependencies.config.stationId,
          siteId: this.dependencies.config.siteId,
          sourceSystem: this.dependencies.config.centralSourceSystem,
          requestId: `station-${inbound.id}`,
        },
      );
      if (result.outcome === "REJECTED") {
        await this.dependencies.repository.markSynchronizationTerminal(
          inbound.id,
          "CONFLICT",
          result.errorCode ?? "BHS_CENTRAL_CONFLICT",
        );
        return "CONFLICT" as const;
      }
      if (result.outcome === "FAILED") {
        await this.dependencies.repository.markSynchronizationTerminal(
          inbound.id,
          "PERMANENT_FAILURE",
          result.errorCode ?? "BHS_CENTRAL_FAILED",
        );
        return "PERMANENT_FAILURE" as const;
      }
      const status = result.outcome === "DUPLICATE" ? "DUPLICATE_CONFIRMED" : "SYNCHRONIZED";
      await this.dependencies.repository.markSynchronized(inbound.id, status);
      return status === "SYNCHRONIZED" ? ("SYNCED" as const) : ("DUPLICATE_CONFIRMED" as const);
    } catch (error) {
      const safe = sanitizeIntegrationError(error);
      this.lastError = safe;
      await this.dependencies.repository.markSynchronizationPending(
        inbound.id,
        safe.includes("AUTH") ? "BHS_CENTRAL_AUTHENTICATION_FAILED" : "BHS_CENTRAL_UNAVAILABLE",
      );
      return "PENDING" as const;
    }
  }

  async receiveBhsMessage(
    messageInput: Uint8Array | BhsBagMessageV1,
  ): Promise<StationReceiveResult> {
    const rawFrame =
      messageInput instanceof Uint8Array
        ? Uint8Array.from(messageInput)
        : encodeBhsWireMessage2001(messageInput);
    let message: BhsWireMessage2001;
    try {
      message = decodeBhsWireMessage2001(rawFrame, "SIMULATED");
    } catch (error) {
      return this.recordRejected(
        "BHS_WIRE_MESSAGE_INVALID",
        sanitizeIntegrationError(error),
        rawFrame,
      );
    }
    if (!this.dependencies.config.allowedLineIds.includes(message.lineId)) {
      return this.recordRejected(
        "BHS_LINE_NOT_ASSIGNED_TO_STATION",
        "The trusted station configuration does not allow this LineID",
        rawFrame,
        message.bhsUid,
      );
    }

    let saved: SaveInboundResult;
    try {
      const semanticMessage: BhsBagMessageV1 = {
        messageType: message.messageType,
        trigger: message.trigger,
        lineId: message.lineId,
        bhsUid: message.bhsUid,
        evaluation: message.evaluation,
      };
      saved = await this.dependencies.repository.saveInboundMessage({
        stationId: this.dependencies.config.stationId,
        siteId: this.dependencies.config.siteId,
        sourceSystem: this.dependencies.config.centralSourceSystem,
        fingerprint: createBhsMessageFingerprint(semanticMessage),
        message,
        rawFrame,
        acknowledgementRequired: this.dependencies.config.acknowledgementEnabled,
        taggingEligible: message.evaluation !== "A",
        receivedAt: this.now(),
      });
    } catch (error) {
      this.lastError = sanitizeIntegrationError(error);
      return {
        outcome: "FAILED" as const,
        inboundMessageId: null,
        queueItemId: null,
        acknowledgement: "NOT_SENT" as const,
        synchronization: "NOT_ATTEMPTED" as const,
        errorCode: "STATION_DURABLE_SAVE_FAILED",
      };
    }

    let acknowledgement: StationReceiveResult["acknowledgement"] = this.dependencies.config
      .acknowledgementEnabled
      ? "PENDING"
      : "DISABLED";
    if (this.acknowledgementAllowed(saved)) {
      acknowledgement = (await this.acknowledge(saved.inbound)) ? "SENT" : "PENDING";
    } else if (this.dependencies.config.acknowledgementEnabled) {
      await this.dependencies.repository.markAcknowledgementNotRequired(saved.inbound.id);
      acknowledgement = "NOT_SENT";
    }

    const synchronization = await this.synchronize(saved.inbound);
    return {
      outcome: saved.duplicate ? "DUPLICATE" : saved.inbound.outcome,
      inboundMessageId: saved.inbound.id,
      queueItemId: saved.queueItem?.id ?? null,
      acknowledgement,
      synchronization,
      errorCode:
        saved.inbound.outcome === "QUEUE_CAPACITY_REACHED" ||
        saved.inbound.outcome === "MESSAGE_IDENTITY_CONFLICT"
          ? saved.inbound.outcome
          : null,
    };
  }

  async getQueue() {
    return this.dependencies.repository.loadQueue();
  }

  async startTagging(queueItemId: string, actor: StationActor) {
    if (!actor.permissions.has("bag.tag")) throw new Error("STATION_OPERATOR_UNAUTHORIZED");
    const queue = await this.dependencies.repository.loadQueue();
    const item = [queue.position1, queue.position2].find(
      (candidate) => candidate?.id === queueItemId,
    );
    if (item && !["SYNCHRONIZED", "DUPLICATE_CONFIRMED"].includes(item.synchronizationStatus)) {
      throw new Error("OFFLINE_TAGGING_DISABLED");
    }
    await this.dependencies.repository.startTagging(queueItemId, actor.id);
  }

  async bindTaggingSession(queueItemId: string, sessionId: string, actor: StationActor) {
    if (!actor.permissions.has("bag.tag")) throw new Error("STATION_OPERATOR_UNAUTHORIZED");
    await this.dependencies.repository.bindTaggingSession(queueItemId, sessionId, actor.id);
  }

  async completeTagging(
    queueItemId: string,
    sessionId: string,
    assignmentId: string,
    actor: StationActor,
  ) {
    if (!actor.permissions.has("bag.tag")) throw new Error("STATION_OPERATOR_UNAUTHORIZED");
    await this.dependencies.repository.completeTagging(
      queueItemId,
      actor.id,
      sessionId,
      assignmentId,
    );
  }

  async clearJammedBag(queueItemId: string, reason: string, actor: StationActor) {
    if (!actor.permissions.has("station.jam.clear")) {
      throw new Error("STATION_JAM_CLEAR_UNAUTHORIZED");
    }
    await this.dependencies.repository.clearJammedBag(queueItemId, reason, actor.id);
  }

  async retryAcknowledgements() {
    const pending = await this.dependencies.repository.loadPendingAcknowledgements();
    for (const inbound of pending) {
      try {
        await this.acknowledge(inbound);
      } catch (error) {
        await this.dependencies.repository.markAcknowledgementPending(
          inbound.id,
          sanitizeIntegrationError(error),
        );
      }
    }
  }

  private async synchronizePending() {
    const pending = await this.dependencies.repository.loadPendingSynchronization();
    for (const inbound of pending) await this.synchronize(inbound);
  }

  async retrySynchronization(_queueItemId: string | null, actor: StationActor) {
    if (!actor.permissions.has("station.sync.retry")) {
      throw new Error("STATION_SYNC_RETRY_UNAUTHORIZED");
    }
    await this.synchronizePending();
  }

  async getHealth(): Promise<StationAgentHealth> {
    const [transport, pendingAck, pendingSync, queue] = await Promise.all([
      this.dependencies.transport.getHealth(),
      this.dependencies.repository.loadPendingAcknowledgements(),
      this.dependencies.repository.loadPendingSynchronization(),
      this.dependencies.repository.loadQueue(),
    ]);
    const occupied = Number(Boolean(queue.position1)) + Number(Boolean(queue.position2));
    const state: StationAgentHealth["state"] = !this.started
      ? "STOPPED"
      : transport.state === "MISCONFIGURED"
        ? "MISCONFIGURED"
        : transport.state === "OFFLINE" || transport.state === "STOPPED"
          ? "OFFLINE"
          : pendingAck.length > 0 || pendingSync.length > 0 || transport.state === "DEGRADED"
            ? "DEGRADED"
            : "ONLINE";
    return {
      state,
      transport,
      pendingAcknowledgements: pendingAck.length,
      pendingSynchronizations: pendingSync.length,
      queueOccupied: occupied,
      detail: this.lastError,
    };
  }
}
