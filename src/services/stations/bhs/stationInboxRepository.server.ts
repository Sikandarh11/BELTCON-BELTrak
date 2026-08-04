import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { BhsWireMessage2001 } from "./bhsWireCodec";

export type TaggingQueueItemState =
  | "RECEIVED"
  | "WAITING"
  | "ACTIVE"
  | "TAGGING_IN_PROGRESS"
  | "TAGGED"
  | "DISPATCHED"
  | "JAMMED"
  | "MANUALLY_CLEARED"
  | "SYNC_PENDING"
  | "FAILED"
  | "CANCELLED";

export type StationReceiveOutcome =
  | "ACCEPTED"
  | "NOT_QUEUED"
  | "DUPLICATE"
  | "QUEUE_CAPACITY_REACHED"
  | "MESSAGE_IDENTITY_CONFLICT";

export interface StoredInboundMessage {
  id: string;
  stationId: string;
  siteId: string;
  sourceSystem: string;
  fingerprint: string;
  lineId: string;
  bhsUid: string;
  evaluation: BhsWireMessage2001["evaluation"];
  rawFrameHex: string;
  outcome: StationReceiveOutcome;
  acknowledgementStatus: "NOT_REQUIRED" | "PENDING" | "SENT";
  synchronizationStatus:
    | "NOT_STARTED"
    | "PENDING"
    | "IN_PROGRESS"
    | "SYNCHRONIZED"
    | "DUPLICATE_CONFIRMED"
    | "CONFLICT"
    | "RETRY_PENDING"
    | "PERMANENT_FAILURE";
  attemptCount: number;
  lastErrorCode: string | null;
  receivedAt: string;
  updatedAt: string;
}

export interface StoredTaggingQueueItem {
  id: string;
  inboundMessageId: string;
  stationId: string;
  bhsUid: string;
  lineId: string;
  evaluation: BhsWireMessage2001["evaluation"];
  position: 1 | 2;
  state: TaggingQueueItemState;
  synchronizationStatus: StoredInboundMessage["synchronizationStatus"];
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
  centralTaggingSessionId: string | null;
  centralAssignmentId: string | null;
}

export interface StationQueueState {
  position1: StoredTaggingQueueItem | null;
  position2: StoredTaggingQueueItem | null;
  alarms: Array<{
    id: string;
    code: string;
    bhsUid: string | null;
    active: boolean;
    detail: string;
    createdAt: string;
  }>;
}

export interface SaveInboundInput {
  stationId: string;
  siteId: string;
  sourceSystem: string;
  fingerprint: string;
  message: BhsWireMessage2001;
  rawFrame: Uint8Array;
  acknowledgementRequired: boolean;
  taggingEligible: boolean;
  receivedAt: string;
}

export interface SaveInboundResult {
  inbound: StoredInboundMessage;
  queueItem: StoredTaggingQueueItem | null;
  duplicate: boolean;
}

export interface StationInboxRepository {
  saveInboundMessage(input: SaveInboundInput): Promise<SaveInboundResult>;
  loadQueue(): Promise<StationQueueState>;
  loadPendingSynchronization(): Promise<StoredInboundMessage[]>;
  loadPendingAcknowledgements(): Promise<StoredInboundMessage[]>;
  markAcknowledged(inboundId: string): Promise<void>;
  markAcknowledgementPending(inboundId: string, errorCode: string): Promise<void>;
  markAcknowledgementNotRequired(inboundId: string): Promise<void>;
  markSynchronized(
    inboundId: string,
    status?: "SYNCHRONIZED" | "DUPLICATE_CONFIRMED",
  ): Promise<void>;
  markSynchronizationTerminal(
    inboundId: string,
    status: "CONFLICT" | "PERMANENT_FAILURE",
    errorCode: string,
  ): Promise<void>;
  markSynchronizationPending(inboundId: string, errorCode: string): Promise<void>;
  startTagging(queueItemId: string, operatorId: string): Promise<void>;
  bindTaggingSession(queueItemId: string, sessionId: string, operatorId: string): Promise<void>;
  completeTagging(
    queueItemId: string,
    operatorId: string,
    sessionId: string,
    assignmentId: string,
  ): Promise<void>;
  jamActive(queueItemId: string, reason: string): Promise<void>;
  clearJammedBag(queueItemId: string, reason: string, operatorId: string): Promise<void>;
  cancelWaiting(queueItemId: string, reason: string, operatorId: string): Promise<void>;
  recordRejectedAttempt(input: {
    stationId: string;
    siteId: string;
    code: string;
    detail: string;
    rawFrame?: Uint8Array;
    bhsUid?: string;
  }): Promise<void>;
  auditConfiguration(previousHash: string | null, nextHash: string, actorId: string): Promise<void>;
  recordSimulationFault(code: string, detail: string): Promise<void>;
  listSimulationFaults(): Promise<Array<{ code: string; detail: string; createdAt: string }>>;
  cleanupRetained(beforeIso: string): Promise<number>;
  resetSimulationData(): Promise<void>;
  close(): void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function mapInbound(value: unknown): StoredInboundMessage {
  const row = asRecord(value);
  return {
    id: text(row.id),
    stationId: text(row.station_id),
    siteId: text(row.site_id),
    sourceSystem: text(row.source_system),
    fingerprint: text(row.fingerprint),
    lineId: text(row.line_id),
    bhsUid: text(row.bhs_uid),
    evaluation: text(row.evaluation) as StoredInboundMessage["evaluation"],
    rawFrameHex: text(row.raw_frame_hex),
    outcome: text(row.processing_outcome) as StationReceiveOutcome,
    acknowledgementStatus: text(
      row.acknowledgement_status,
    ) as StoredInboundMessage["acknowledgementStatus"],
    synchronizationStatus: text(
      row.synchronization_status,
    ) as StoredInboundMessage["synchronizationStatus"],
    attemptCount: Number(row.attempt_count),
    lastErrorCode: nullableText(row.last_error_code),
    receivedAt: text(row.received_at),
    updatedAt: text(row.updated_at),
  };
}

function mapQueueItem(value: unknown): StoredTaggingQueueItem {
  const row = asRecord(value);
  return {
    id: text(row.id),
    inboundMessageId: text(row.inbound_message_id),
    stationId: text(row.station_id),
    bhsUid: text(row.bhs_uid),
    lineId: text(row.line_id),
    evaluation: text(row.evaluation) as StoredTaggingQueueItem["evaluation"],
    position: Number(row.position) as 1 | 2,
    state: text(row.state) as TaggingQueueItemState,
    synchronizationStatus: text(
      row.synchronization_status,
    ) as StoredInboundMessage["synchronizationStatus"],
    receivedAt: text(row.received_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    centralTaggingSessionId: nullableText(row.central_tagging_session_id),
    centralAssignmentId: nullableText(row.central_assignment_id),
  };
}

const INBOUND_COLUMNS = `id,station_id,site_id,source_system,fingerprint,line_id,bhs_uid,evaluation,
  raw_frame_hex,processing_outcome,acknowledgement_status,synchronization_status,attempt_count,
  last_error_code,received_at,updated_at`;
const QUEUE_COLUMNS = `id,inbound_message_id,station_id,bhs_uid,line_id,evaluation,position,state,created_at,updated_at,
  central_tagging_session_id,central_assignment_id,
  (SELECT synchronization_status FROM station_inbound_messages WHERE id=inbound_message_id) AS synchronization_status,
  (SELECT received_at FROM station_inbound_messages WHERE id=inbound_message_id) AS received_at`;

export class SqliteStationInboxRepository implements StationInboxRepository {
  private readonly database: DatabaseSync;

  constructor(
    databasePath: string,
    private readonly stationId: string,
    private readonly siteId: string,
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    try {
      this.database.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
      );
      this.database.exec(`
      CREATE TABLE IF NOT EXISTS station_inbound_messages (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        source_system TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        line_id TEXT NOT NULL,
        bhs_uid TEXT NOT NULL,
        evaluation TEXT NOT NULL CHECK(evaluation IN ('A','R','T','N','?')),
        raw_frame_hex TEXT NOT NULL,
        processing_outcome TEXT NOT NULL,
        acknowledgement_status TEXT NOT NULL CHECK(acknowledgement_status IN ('NOT_REQUIRED','PENDING','SENT')),
        synchronization_status TEXT NOT NULL CHECK(synchronization_status IN (
          'NOT_STARTED','PENDING','IN_PROGRESS','SYNCHRONIZED','DUPLICATE_CONFIRMED',
          'CONFLICT','RETRY_PENDING','PERMANENT_FAILURE'
        )),
        attempt_count INTEGER NOT NULL DEFAULT 1,
        acknowledgement_attempt_count INTEGER NOT NULL DEFAULT 0,
        synchronization_attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_system, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS station_tagging_queue (
        id TEXT PRIMARY KEY,
        inbound_message_id TEXT NOT NULL UNIQUE REFERENCES station_inbound_messages(id),
        station_id TEXT NOT NULL,
        bhs_uid TEXT NOT NULL,
        line_id TEXT NOT NULL,
        evaluation TEXT NOT NULL,
        position INTEGER CHECK(position IN (1,2)),
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS station_tagging_queue_position_unique
        ON station_tagging_queue(station_id, position) WHERE position IS NOT NULL;
      CREATE TABLE IF NOT EXISTS station_integration_attempts (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        code TEXT NOT NULL,
        detail TEXT NOT NULL,
        bhs_uid TEXT,
        raw_frame_hex TEXT,
        simulated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS station_operational_alarms (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        code TEXT NOT NULL,
        bhs_uid TEXT,
        detail TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        cleared_at TEXT
      );
      CREATE TABLE IF NOT EXISTS station_configuration_audit (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        previous_hash TEXT,
        next_hash TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      `);
      const queueColumns = new Set(
        this.database
          .prepare("PRAGMA table_info(station_tagging_queue)")
          .all()
          .map((row) => text(asRecord(row).name)),
      );
      if (!queueColumns.has("central_tagging_session_id")) {
        this.database.exec(
          "ALTER TABLE station_tagging_queue ADD COLUMN central_tagging_session_id TEXT",
        );
      }
      if (!queueColumns.has("central_assignment_id")) {
        this.database.exec(
          "ALTER TABLE station_tagging_queue ADD COLUMN central_assignment_id TEXT",
        );
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async saveInboundMessage(input: SaveInboundInput): Promise<SaveInboundResult> {
    if (input.stationId !== this.stationId || input.siteId !== this.siteId) {
      throw new Error("STATION_REPOSITORY_BINDING_MISMATCH");
    }
    return this.transaction(() => {
      const now = input.receivedAt;
      const existing = this.database
        .prepare(
          `SELECT ${INBOUND_COLUMNS} FROM station_inbound_messages WHERE source_system=? AND fingerprint=?`,
        )
        .get(input.sourceSystem, input.fingerprint);
      if (existing) {
        const mapped = mapInbound(existing);
        if (mapped.stationId !== this.stationId || mapped.siteId !== this.siteId) {
          throw new Error("CROSS_STATION_MESSAGE_COLLISION");
        }
        this.database
          .prepare(
            "UPDATE station_inbound_messages SET attempt_count=attempt_count+1,updated_at=? WHERE id=?",
          )
          .run(now, mapped.id);
        const refreshed = this.database
          .prepare(`SELECT ${INBOUND_COLUMNS} FROM station_inbound_messages WHERE id=?`)
          .get(mapped.id);
        const queue = this.database
          .prepare(`SELECT ${QUEUE_COLUMNS} FROM station_tagging_queue WHERE inbound_message_id=?`)
          .get(mapped.id);
        return {
          inbound: mapInbound(refreshed),
          queueItem: queue ? mapQueueItem(queue) : null,
          duplicate: true,
        };
      }

      let outcome: StationReceiveOutcome = input.taggingEligible ? "ACCEPTED" : "NOT_QUEUED";
      let position: 1 | 2 | null = null;
      if (input.taggingEligible) {
        const identity = this.database
          .prepare(
            "SELECT line_id,evaluation FROM station_inbound_messages WHERE station_id=? AND bhs_uid=? ORDER BY received_at LIMIT 1",
          )
          .get(this.stationId, input.message.bhsUid);
        if (identity) {
          outcome = "MESSAGE_IDENTITY_CONFLICT";
        } else {
          const occupied = this.database
            .prepare(
              "SELECT position FROM station_tagging_queue WHERE station_id=? AND position IS NOT NULL ORDER BY position",
            )
            .all(this.stationId)
            .map((row) => Number(asRecord(row).position));
          if (occupied.length >= 2) outcome = "QUEUE_CAPACITY_REACHED";
          else position = occupied.includes(1) ? 2 : 1;
        }
      }

      const inboundId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO station_inbound_messages(
          id,station_id,site_id,source_system,fingerprint,line_id,bhs_uid,evaluation,raw_frame_hex,
          processing_outcome,acknowledgement_status,synchronization_status,received_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          inboundId,
          this.stationId,
          this.siteId,
          input.sourceSystem,
          input.fingerprint,
          input.message.lineId,
          input.message.bhsUid,
          input.message.evaluation,
          Buffer.from(input.rawFrame).toString("hex"),
          outcome,
          input.acknowledgementRequired ? "PENDING" : "NOT_REQUIRED",
          "PENDING",
          now,
          now,
        );

      let queueItem: StoredTaggingQueueItem | null = null;
      if (position !== null) {
        const queueId = randomUUID();
        const state: TaggingQueueItemState = position === 1 ? "ACTIVE" : "WAITING";
        this.database
          .prepare(
            `INSERT INTO station_tagging_queue(
            id,inbound_message_id,station_id,bhs_uid,line_id,evaluation,position,state,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            queueId,
            inboundId,
            this.stationId,
            input.message.bhsUid,
            input.message.lineId,
            input.message.evaluation,
            position,
            state,
            now,
            now,
          );
        queueItem = mapQueueItem(
          this.database
            .prepare(`SELECT ${QUEUE_COLUMNS} FROM station_tagging_queue WHERE id=?`)
            .get(queueId),
        );
      }

      if (outcome === "QUEUE_CAPACITY_REACHED" || outcome === "MESSAGE_IDENTITY_CONFLICT") {
        const code = outcome;
        const detail =
          outcome === "QUEUE_CAPACITY_REACHED"
            ? "The two physical tagging positions are occupied"
            : "The BagID was received with changed LineID or evaluation data";
        this.database
          .prepare(
            "INSERT INTO station_operational_alarms(id,station_id,code,bhs_uid,detail,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(randomUUID(), this.stationId, code, input.message.bhsUid, detail, now);
      }

      const inbound = this.database
        .prepare(`SELECT ${INBOUND_COLUMNS} FROM station_inbound_messages WHERE id=?`)
        .get(inboundId);
      return { inbound: mapInbound(inbound), queueItem, duplicate: false };
    });
  }

  async loadQueue(): Promise<StationQueueState> {
    const items = this.database
      .prepare(
        `SELECT ${QUEUE_COLUMNS} FROM station_tagging_queue
         WHERE station_id=? AND position IS NOT NULL ORDER BY position`,
      )
      .all(this.stationId)
      .map(mapQueueItem);
    const alarms = this.database
      .prepare(
        "SELECT id,code,bhs_uid,detail,active,created_at FROM station_operational_alarms WHERE station_id=? AND active=1 ORDER BY created_at,id",
      )
      .all(this.stationId)
      .map((value) => {
        const row = asRecord(value);
        return {
          id: text(row.id),
          code: text(row.code),
          bhsUid: nullableText(row.bhs_uid),
          detail: text(row.detail),
          active: Number(row.active) === 1,
          createdAt: text(row.created_at),
        };
      });
    return {
      position1: items.find((item) => item.position === 1) ?? null,
      position2: items.find((item) => item.position === 2) ?? null,
      alarms,
    };
  }

  private pending(column: "synchronization_status" | "acknowledgement_status", value: string) {
    return this.database
      .prepare(
        `SELECT ${INBOUND_COLUMNS} FROM station_inbound_messages WHERE station_id=? AND ${column}=? ORDER BY received_at,id`,
      )
      .all(this.stationId, value)
      .map(mapInbound);
  }

  async loadPendingSynchronization() {
    return this.database
      .prepare(
        `SELECT ${INBOUND_COLUMNS} FROM station_inbound_messages
         WHERE station_id=? AND synchronization_status IN ('NOT_STARTED','PENDING','RETRY_PENDING')
         ORDER BY received_at,id`,
      )
      .all(this.stationId)
      .map(mapInbound);
  }

  async loadPendingAcknowledgements() {
    return this.pending("acknowledgement_status", "PENDING");
  }

  async markAcknowledged(inboundId: string) {
    this.database
      .prepare(
        "UPDATE station_inbound_messages SET acknowledgement_status='SENT',acknowledgement_attempt_count=acknowledgement_attempt_count+1,last_error_code=NULL,updated_at=? WHERE id=? AND station_id=?",
      )
      .run(new Date().toISOString(), inboundId, this.stationId);
  }

  async markAcknowledgementPending(inboundId: string, errorCode: string) {
    this.database
      .prepare(
        "UPDATE station_inbound_messages SET acknowledgement_status='PENDING',acknowledgement_attempt_count=acknowledgement_attempt_count+1,last_error_code=?,updated_at=? WHERE id=? AND station_id=?",
      )
      .run(errorCode, new Date().toISOString(), inboundId, this.stationId);
  }

  async markAcknowledgementNotRequired(inboundId: string) {
    this.database
      .prepare(
        "UPDATE station_inbound_messages SET acknowledgement_status='NOT_REQUIRED',last_error_code=NULL,updated_at=? WHERE id=? AND station_id=?",
      )
      .run(new Date().toISOString(), inboundId, this.stationId);
  }

  async markSynchronized(
    inboundId: string,
    status: "SYNCHRONIZED" | "DUPLICATE_CONFIRMED" = "SYNCHRONIZED",
  ) {
    this.database
      .prepare(
        "UPDATE station_inbound_messages SET synchronization_status=?,synchronization_attempt_count=synchronization_attempt_count+1,last_error_code=NULL,updated_at=? WHERE id=? AND station_id=?",
      )
      .run(status, new Date().toISOString(), inboundId, this.stationId);
  }

  async markSynchronizationTerminal(
    inboundId: string,
    status: "CONFLICT" | "PERMANENT_FAILURE",
    errorCode: string,
  ) {
    this.database
      .prepare(
        "UPDATE station_inbound_messages SET synchronization_status=?,synchronization_attempt_count=synchronization_attempt_count+1,last_error_code=?,updated_at=? WHERE id=? AND station_id=?",
      )
      .run(status, errorCode, new Date().toISOString(), inboundId, this.stationId);
  }

  async markSynchronizationPending(inboundId: string, errorCode: string) {
    this.database
      .prepare(
        "UPDATE station_inbound_messages SET synchronization_status='RETRY_PENDING',synchronization_attempt_count=synchronization_attempt_count+1,last_error_code=?,updated_at=? WHERE id=? AND station_id=?",
      )
      .run(errorCode, new Date().toISOString(), inboundId, this.stationId);
  }

  private requirePosition(queueItemId: string, position: 1 | 2) {
    const row = this.database
      .prepare(`SELECT ${QUEUE_COLUMNS} FROM station_tagging_queue WHERE id=? AND station_id=?`)
      .get(queueItemId, this.stationId);
    if (!row) throw new Error("QUEUE_ITEM_NOT_FOUND");
    const item = mapQueueItem(row);
    if (item.position !== position) throw new Error("QUEUE_POSITION_INVALID");
    return item;
  }

  private auditAction(code: string, detail: string, bhsUid: string) {
    this.database
      .prepare(
        "INSERT INTO station_integration_attempts(id,station_id,site_id,code,detail,bhs_uid,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        this.stationId,
        this.siteId,
        code,
        detail,
        bhsUid,
        new Date().toISOString(),
      );
  }

  async startTagging(queueItemId: string, operatorId: string) {
    const item = this.requirePosition(queueItemId, 1);
    if (item.state !== "ACTIVE") throw new Error("QUEUE_ITEM_NOT_ACTIVE");
    this.database
      .prepare(
        "UPDATE station_tagging_queue SET state='TAGGING_IN_PROGRESS',updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), item.id);
    this.auditAction("TAGGING_STARTED", `operator=${operatorId}`, item.bhsUid);
  }

  async bindTaggingSession(queueItemId: string, sessionId: string, operatorId: string) {
    const item = this.requirePosition(queueItemId, 1);
    if (item.state !== "TAGGING_IN_PROGRESS") throw new Error("TAGGING_NOT_IN_PROGRESS");
    if (item.centralTaggingSessionId && item.centralTaggingSessionId !== sessionId) {
      throw new Error("CENTRAL_TAGGING_SESSION_CONFLICT");
    }
    this.database
      .prepare(
        "UPDATE station_tagging_queue SET central_tagging_session_id=?,updated_at=? WHERE id=? AND station_id=?",
      )
      .run(sessionId, new Date().toISOString(), item.id, this.stationId);
    this.auditAction(
      "CENTRAL_TAGGING_SESSION_BOUND",
      `session=${sessionId};operator=${operatorId}`,
      item.bhsUid,
    );
  }

  private advanceWaiting(now: string) {
    this.database
      .prepare(
        "UPDATE station_tagging_queue SET position=1,state='ACTIVE',updated_at=? WHERE station_id=? AND position=2",
      )
      .run(now, this.stationId);
  }

  async completeTagging(
    queueItemId: string,
    operatorId: string,
    sessionId: string,
    assignmentId: string,
  ) {
    this.transaction(() => {
      const item = this.requirePosition(queueItemId, 1);
      if (item.state !== "TAGGING_IN_PROGRESS") throw new Error("TAGGING_NOT_IN_PROGRESS");
      if (!sessionId || !assignmentId || item.centralTaggingSessionId !== sessionId) {
        throw new Error("CENTRAL_TAGGING_COMMIT_EVIDENCE_REQUIRED");
      }
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE station_tagging_queue SET position=NULL,state='DISPATCHED',central_assignment_id=?,updated_at=? WHERE id=?",
        )
        .run(assignmentId, now, item.id);
      this.advanceWaiting(now);
      this.auditAction(
        "TAGGING_COMPLETED",
        `session=${sessionId};assignment=${assignmentId};operator=${operatorId}`,
        item.bhsUid,
      );
    });
  }

  async jamActive(queueItemId: string, reason: string) {
    const item = this.requirePosition(queueItemId, 1);
    this.database
      .prepare("UPDATE station_tagging_queue SET state='JAMMED',updated_at=? WHERE id=?")
      .run(new Date().toISOString(), item.id);
    this.auditAction("BAG_JAMMED", reason, item.bhsUid);
  }

  async clearJammedBag(queueItemId: string, reason: string, operatorId: string) {
    this.transaction(() => {
      const item = this.requirePosition(queueItemId, 1);
      if (item.state !== "JAMMED") throw new Error("QUEUE_ITEM_NOT_JAMMED");
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE station_tagging_queue SET position=NULL,state='MANUALLY_CLEARED',updated_at=? WHERE id=?",
        )
        .run(now, item.id);
      this.advanceWaiting(now);
      this.auditAction("JAM_MANUALLY_CLEARED", `${reason};operator=${operatorId}`, item.bhsUid);
    });
  }

  async cancelWaiting(queueItemId: string, reason: string, operatorId: string) {
    const item = this.requirePosition(queueItemId, 2);
    this.database
      .prepare(
        "UPDATE station_tagging_queue SET position=NULL,state='CANCELLED',updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), item.id);
    this.auditAction("WAITING_BAG_CANCELLED", `${reason};operator=${operatorId}`, item.bhsUid);
  }

  async recordRejectedAttempt(input: {
    stationId: string;
    siteId: string;
    code: string;
    detail: string;
    rawFrame?: Uint8Array;
    bhsUid?: string;
  }) {
    if (input.stationId !== this.stationId || input.siteId !== this.siteId) {
      throw new Error("STATION_REPOSITORY_BINDING_MISMATCH");
    }
    this.database
      .prepare(
        "INSERT INTO station_integration_attempts(id,station_id,site_id,code,detail,bhs_uid,raw_frame_hex,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        this.stationId,
        this.siteId,
        input.code,
        input.detail.slice(0, 256),
        input.bhsUid ?? null,
        input.rawFrame ? Buffer.from(input.rawFrame).toString("hex") : null,
        new Date().toISOString(),
      );
  }

  async auditConfiguration(previousHash: string | null, nextHash: string, actorId: string) {
    this.database
      .prepare(
        "INSERT INTO station_configuration_audit(id,station_id,site_id,previous_hash,next_hash,actor_id,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        this.stationId,
        this.siteId,
        previousHash,
        nextHash,
        actorId,
        new Date().toISOString(),
      );
  }

  async recordSimulationFault(code: string, detail: string) {
    this.database
      .prepare(
        "INSERT INTO station_integration_attempts(id,station_id,site_id,code,detail,simulated,created_at) VALUES(?,?,?,?,?,1,?)",
      )
      .run(
        randomUUID(),
        this.stationId,
        this.siteId,
        code,
        detail.slice(0, 256),
        new Date().toISOString(),
      );
  }

  async listSimulationFaults() {
    return this.database
      .prepare(
        "SELECT code,detail,created_at FROM station_integration_attempts WHERE station_id=? AND simulated=1 ORDER BY created_at,id",
      )
      .all(this.stationId)
      .map((entry) => {
        const source = asRecord(entry);
        return {
          code: text(source.code),
          detail: text(source.detail),
          createdAt: text(source.created_at),
        };
      });
  }

  async cleanupRetained(beforeIso: string) {
    if (!Number.isFinite(Date.parse(beforeIso)))
      throw new Error("STATION_RETENTION_CUTOFF_INVALID");
    return this.transaction(() => {
      const result = this.database
        .prepare(
          `DELETE FROM station_inbound_messages
           WHERE station_id=?
             AND updated_at<?
             AND acknowledgement_status IN ('NOT_REQUIRED','SENT')
             AND synchronization_status IN ('SYNCHRONIZED','DUPLICATE_CONFIRMED','CONFLICT','PERMANENT_FAILURE')
             AND NOT EXISTS (
               SELECT 1 FROM station_tagging_queue queue
               WHERE queue.inbound_message_id=station_inbound_messages.id
             )`,
        )
        .run(this.stationId, beforeIso);
      return Number(result.changes);
    });
  }

  async resetSimulationData() {
    this.transaction(() => {
      this.database
        .prepare("DELETE FROM station_tagging_queue WHERE station_id=?")
        .run(this.stationId);
      this.database
        .prepare("DELETE FROM station_operational_alarms WHERE station_id=?")
        .run(this.stationId);
      this.database
        .prepare("DELETE FROM station_integration_attempts WHERE station_id=?")
        .run(this.stationId);
      this.database
        .prepare("DELETE FROM station_inbound_messages WHERE station_id=?")
        .run(this.stationId);
    });
  }

  close() {
    this.database.close();
  }
}
