import "@tanstack/react-start/server-only";

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { HbssBidFramingProfile } from "./hbssBidCodec";

export type RecheckRecallState =
  | "CREATED"
  | "VALIDATING"
  | "READY_TO_SEND"
  | "OPENING_PORT"
  | "WRITING"
  | "REQUEST_SENT"
  | "TIMED_OUT"
  | "FAILED"
  | "CANCELLED"
  | "RETRY_PENDING"
  | "SIMULATED"
  | "UNAVAILABLE";

export interface LocalRecallRequest {
  requestId: string;
  stationId: string;
  siteId: string;
  bagId: string;
  bhsUid: string;
  barcode: string;
  rawBarcode: string;
  framingProfile: HbssBidFramingProfile;
  state: RecheckRecallState;
  encodedBytesHex: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

const transitions: Record<RecheckRecallState, ReadonlySet<RecheckRecallState>> = {
  CREATED: new Set(["VALIDATING", "CANCELLED"]),
  VALIDATING: new Set(["READY_TO_SEND", "FAILED", "CANCELLED"]),
  READY_TO_SEND: new Set(["OPENING_PORT", "CANCELLED"]),
  OPENING_PORT: new Set(["WRITING", "UNAVAILABLE", "TIMED_OUT", "FAILED", "CANCELLED"]),
  WRITING: new Set(["REQUEST_SENT", "SIMULATED", "TIMED_OUT", "FAILED", "CANCELLED"]),
  REQUEST_SENT: new Set(),
  TIMED_OUT: new Set(["RETRY_PENDING"]),
  FAILED: new Set(["RETRY_PENDING"]),
  CANCELLED: new Set(),
  RETRY_PENDING: new Set(["VALIDATING", "CANCELLED"]),
  SIMULATED: new Set(),
  UNAVAILABLE: new Set(["RETRY_PENDING"]),
};

function row(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function value(value: unknown) {
  return typeof value === "string" ? value : "";
}
function optional(value: unknown) {
  return typeof value === "string" && value ? value : null;
}
function mapRecall(input: unknown): LocalRecallRequest {
  const source = row(input);
  return {
    requestId: value(source.request_id),
    stationId: value(source.station_id),
    siteId: value(source.site_id),
    bagId: value(source.bag_id),
    bhsUid: value(source.bhs_uid),
    barcode: value(source.barcode),
    rawBarcode: value(source.raw_barcode),
    framingProfile: value(source.framing_profile) as HbssBidFramingProfile,
    state: value(source.state) as RecheckRecallState,
    encodedBytesHex: optional(source.encoded_bytes_hex),
    errorCode: optional(source.error_code),
    errorMessage: optional(source.error_message),
    attemptCount: Number(source.attempt_count),
    createdAt: value(source.created_at),
    updatedAt: value(source.updated_at),
  };
}

const COLUMNS = `request_id,station_id,site_id,bag_id,bhs_uid,barcode,raw_barcode,
  framing_profile,state,encoded_bytes_hex,error_code,error_message,attempt_count,created_at,updated_at`;

export interface RecheckStationRepository {
  create(
    input: Omit<
      LocalRecallRequest,
      | "state"
      | "encodedBytesHex"
      | "errorCode"
      | "errorMessage"
      | "attemptCount"
      | "createdAt"
      | "updatedAt"
    >,
  ): Promise<{ request: LocalRecallRequest; duplicate: boolean }>;
  transition(
    requestId: string,
    state: RecheckRecallState,
    details?: {
      encodedBytes?: Uint8Array;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<LocalRecallRequest>;
  get(requestId: string): Promise<LocalRecallRequest | null>;
  list(): Promise<LocalRecallRequest[]>;
  recoverAfterRestart(): Promise<LocalRecallRequest[]>;
  resetSimulationData(): Promise<void>;
  close(): void;
}

export class SqliteRecheckStationRepository implements RecheckStationRepository {
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
      CREATE TABLE IF NOT EXISTS recheck_station_recall_requests (
        request_id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        bag_id TEXT NOT NULL,
        bhs_uid TEXT NOT NULL,
        barcode TEXT NOT NULL,
        raw_barcode TEXT NOT NULL,
        framing_profile TEXT NOT NULL,
        state TEXT NOT NULL,
        encoded_bytes_hex TEXT,
        error_code TEXT,
        error_message TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recheck_station_recall_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL REFERENCES recheck_station_recall_requests(request_id),
        station_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        error_code TEXT,
        created_at TEXT NOT NULL
      );
      `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private find(requestId: string) {
    const found = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM recheck_station_recall_requests WHERE request_id=? AND station_id=? AND site_id=?`,
      )
      .get(requestId, this.stationId, this.siteId);
    return found ? mapRecall(found) : null;
  }

  async create(
    input: Omit<
      LocalRecallRequest,
      | "state"
      | "encodedBytesHex"
      | "errorCode"
      | "errorMessage"
      | "attemptCount"
      | "createdAt"
      | "updatedAt"
    >,
  ) {
    if (input.stationId !== this.stationId || input.siteId !== this.siteId) {
      throw new Error("RECHECK_REPOSITORY_BINDING_MISMATCH");
    }
    const existing = this.find(input.requestId);
    if (existing) return { request: existing, duplicate: true };
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO recheck_station_recall_requests(
          request_id,station_id,site_id,bag_id,bhs_uid,barcode,raw_barcode,framing_profile,state,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          input.requestId,
          this.stationId,
          this.siteId,
          input.bagId,
          input.bhsUid,
          input.barcode,
          input.rawBarcode,
          input.framingProfile,
          "CREATED",
          now,
          now,
        );
      this.database
        .prepare(
          "INSERT INTO recheck_station_recall_transitions(request_id,station_id,to_state,created_at) VALUES(?,?,?,?)",
        )
        .run(input.requestId, this.stationId, "CREATED", now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { request: this.find(input.requestId)!, duplicate: false };
  }

  async transition(
    requestId: string,
    next: RecheckRecallState,
    details: {
      encodedBytes?: Uint8Array;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {},
  ) {
    const current = this.find(requestId);
    if (!current) throw new Error("HBSS_RECALL_REQUEST_NOT_FOUND");
    if (!transitions[current.state].has(next)) {
      throw new Error(`HBSS_RECALL_TRANSITION_INVALID:${current.state}:${next}`);
    }
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `UPDATE recheck_station_recall_requests SET
          state=?,encoded_bytes_hex=COALESCE(?,encoded_bytes_hex),error_code=?,error_message=?,
          attempt_count=attempt_count+?,updated_at=? WHERE request_id=? AND station_id=? AND site_id=?`,
        )
        .run(
          next,
          details.encodedBytes ? Buffer.from(details.encodedBytes).toString("hex") : null,
          details.errorCode ?? null,
          details.errorMessage?.slice(0, 256) ?? null,
          next === "VALIDATING" && current.state === "RETRY_PENDING" ? 1 : 0,
          now,
          requestId,
          this.stationId,
          this.siteId,
        );
      this.database
        .prepare(
          "INSERT INTO recheck_station_recall_transitions(request_id,station_id,from_state,to_state,error_code,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(requestId, this.stationId, current.state, next, details.errorCode ?? null, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.find(requestId)!;
  }

  async get(requestId: string) {
    return this.find(requestId);
  }

  async list() {
    return this.database
      .prepare(
        `SELECT ${COLUMNS} FROM recheck_station_recall_requests WHERE station_id=? AND site_id=? ORDER BY created_at,request_id`,
      )
      .all(this.stationId, this.siteId)
      .map(mapRecall);
  }

  async recoverAfterRestart() {
    const ambiguous = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM recheck_station_recall_requests WHERE station_id=? AND site_id=? AND state IN ('OPENING_PORT','WRITING')`,
      )
      .all(this.stationId, this.siteId)
      .map(mapRecall);
    for (const request of ambiguous) {
      await this.transition(request.requestId, "FAILED", {
        errorCode: "HBSS_AMBIGUOUS_AFTER_RESTART",
        errorMessage: "The process restarted during serial output; the request was not resent",
      });
    }
    return this.list();
  }

  async resetSimulationData() {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM recheck_station_recall_transitions WHERE station_id=?")
        .run(this.stationId);
      this.database
        .prepare("DELETE FROM recheck_station_recall_requests WHERE station_id=? AND site_id=?")
        .run(this.stationId, this.siteId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
