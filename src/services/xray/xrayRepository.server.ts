import "@tanstack/react-start/server-only";

import { z } from "zod";

import { HbssError } from "@/services/integrations/hbss/hbssErrors";
import { xrayImageViewSchema } from "@/services/integrations/hbss/hbssSchemas";
import type { HbssScanResult, XrayScan, XrayScanSelection } from "@/types/xray";
import {
  HbssBhsUidMismatchError,
  XrayConflictError,
  XrayServiceError,
  XrayPersistenceError,
} from "./xrayErrors";
import { selectXrayScans } from "./xrayScanSelection";
import { getXrayAdminClient } from "./xraySupabase.server";

const xrayScanRowSchema = z.object({
  id: z.string().uuid(),
  bag_id: z.string().nullable(),
  bhs_uid: z.string().min(1),
  external_scan_id: z.string().nullable(),
  source_system: z.string().min(1),
  status: z.enum(["PENDING", "AVAILABLE", "FAILED", "NOT_FOUND", "ARCHIVED"]),
  images: z.array(xrayImageViewSchema),
  threat_level: z.number().int().min(1).max(5).nullable(),
  threat_type: z.string().nullable(),
  captured_at: z.string().nullable(),
  received_at: z.string(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  metadata: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

type XrayScanWrite = {
  bag_id: string;
  bhs_uid: string;
  external_scan_id: string | null;
  source_system: string;
  status: XrayScan["status"];
  images: XrayScan["images"];
  threat_level: number | null;
  threat_type: string | null;
  captured_at: string | null;
  received_at: string;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export interface XrayRepository {
  findSelectionByBagId(bagId: string): Promise<XrayScanSelection>;
  findLatestByBagId(bagId: string): Promise<XrayScan | null>;
  findLatestByBhsUid(bhsUid: string): Promise<XrayScan | null>;
  upsertFromAdapterResult(
    bagId: string,
    expectedBhsUid: string,
    result: HbssScanResult,
  ): Promise<XrayPersistenceResult>;
  saveFailure(bagId: string, bhsUid: string, error: unknown): Promise<XrayScan>;
}

export interface XrayPersistenceResult {
  scan: XrayScan;
  disposition: "CREATED" | "DUPLICATE";
}

export function mapXrayScanRow(row: unknown): XrayScan {
  const parsed = xrayScanRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new XrayPersistenceError("Stored X-ray scan data is invalid", {
      cause: parsed.error,
    });
  }

  const data = parsed.data;
  return {
    id: data.id,
    bagId: data.bag_id,
    bhsUid: data.bhs_uid,
    externalScanId: data.external_scan_id,
    sourceSystem: data.source_system,
    status: data.status,
    images: data.images,
    threatLevel: data.threat_level,
    threatType: data.threat_type,
    capturedAt: data.captured_at,
    receivedAt: data.received_at,
    errorCode: data.error_code,
    errorMessage: data.error_message,
    metadata: data.metadata,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

async function loadSelectionByBagId(bagId: string): Promise<XrayScanSelection> {
  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .select("*")
    .eq("bag_id", bagId)
    .order("received_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new XrayPersistenceError("Unable to load X-ray scan history", { cause: error });
  }

  return selectXrayScans(((data ?? []) as unknown[]).map(mapXrayScanRow));
}

async function findLatest(column: "bag_id" | "bhs_uid", value: string) {
  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .select("*")
    .eq(column, value)
    .order("received_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new XrayPersistenceError("Unable to load X-ray scan data", { cause: error });
  }

  return data ? mapXrayScanRow(data) : null;
}

async function findByExternalIdentity(sourceSystem: string, externalScanId: string) {
  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .select("*")
    .eq("source_system", sourceSystem)
    .eq("external_scan_id", externalScanId)
    .maybeSingle();

  if (error) {
    throw new XrayPersistenceError("Unable to match the X-ray scan record", { cause: error });
  }

  return data ? mapXrayScanRow(data) : null;
}

function assertExternalIdentityOwner(scan: XrayScan, bagId: string, bhsUid: string) {
  if ((scan.bagId !== null && scan.bagId !== bagId) || scan.bhsUid !== bhsUid) {
    throw new XrayConflictError(
      "X-ray scan identity is already assigned to another bag or BHS UID",
    );
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sameOptionalTimestamp(stored: string | null, incoming?: string): boolean {
  if (stored === null || incoming === undefined) {
    return stored === null && incoming === undefined;
  }
  return Date.parse(stored) === Date.parse(incoming);
}

export function isExactHbssScanDuplicate(
  existing: XrayScan,
  bagId: string,
  expectedBhsUid: string,
  incoming: HbssScanResult,
): boolean {
  return (
    existing.bagId === bagId &&
    existing.bhsUid === expectedBhsUid &&
    incoming.bhsUid === expectedBhsUid &&
    existing.externalScanId === incoming.externalScanId &&
    existing.sourceSystem === incoming.sourceSystem &&
    existing.status === incoming.status &&
    canonicalJson(existing.images) === canonicalJson(incoming.images) &&
    existing.threatLevel === (incoming.threatLevel ?? null) &&
    existing.threatType === (incoming.threatType ?? null) &&
    sameOptionalTimestamp(existing.capturedAt, incoming.capturedAt) &&
    canonicalJson(existing.metadata) === canonicalJson(incoming.metadata ?? {})
  );
}

async function updateScan(id: string, values: XrayScanWrite) {
  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .update(values)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new XrayPersistenceError("Unable to update the X-ray scan record", {
      cause: error ?? undefined,
    });
  }

  return mapXrayScanRow(data);
}

async function insertScan(values: XrayScanWrite) {
  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .insert(values)
    .select("*")
    .single();

  return { data, error };
}

function selectedFailureSource() {
  switch (process.env.HBSS_ADAPTER?.trim().toLowerCase()) {
    case "mock":
      return "MOCK_HBSS";
    case "smiths":
      return "SMITHS_HBSS";
    default:
      return "HBSS";
  }
}

function safeFailureDetails(error: unknown) {
  if (error instanceof XrayServiceError) {
    return {
      errorCode: error.code,
      errorMessage: error.message,
    };
  }

  if (error instanceof HbssError) {
    const messages: Record<string, string> = {
      HBSS_CONFIGURATION_ERROR: "HBSS adapter is not configured",
      HBSS_PAYLOAD_VALIDATION_ERROR: "HBSS returned an invalid scan response",
    };
    return {
      errorCode: error.code,
      errorMessage: messages[error.code] ?? "HBSS scan retrieval failed",
    };
  }

  return {
    errorCode: "HBSS_RETRIEVAL_FAILED",
    errorMessage: "HBSS scan retrieval failed",
  };
}

async function findReusableFailure(bagId: string, bhsUid: string, sourceSystem: string) {
  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .select("*")
    .eq("bag_id", bagId)
    .eq("bhs_uid", bhsUid)
    .eq("source_system", sourceSystem)
    .eq("status", "FAILED")
    .is("external_scan_id", null)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new XrayPersistenceError("Unable to match the X-ray failure record", {
      cause: error,
    });
  }

  return data ? mapXrayScanRow(data) : null;
}

export const xrayRepository: XrayRepository = {
  findSelectionByBagId: loadSelectionByBagId,

  findLatestByBagId(bagId) {
    return findLatest("bag_id", bagId);
  },

  findLatestByBhsUid(bhsUid) {
    return findLatest("bhs_uid", bhsUid);
  },

  async upsertFromAdapterResult(bagId, expectedBhsUid, result) {
    if (result.bhsUid !== expectedBhsUid) {
      throw new HbssBhsUidMismatchError();
    }
    const now = new Date().toISOString();
    const values: XrayScanWrite = {
      bag_id: bagId,
      bhs_uid: result.bhsUid,
      external_scan_id: result.externalScanId,
      source_system: result.sourceSystem,
      status: result.status,
      images: result.images,
      threat_level: result.threatLevel ?? null,
      threat_type: result.threatType ?? null,
      captured_at: result.capturedAt ?? null,
      received_at: now,
      error_code: null,
      error_message: null,
      metadata: result.metadata ?? {},
      updated_at: now,
    };

    const existing = await findByExternalIdentity(result.sourceSystem, result.externalScanId);
    if (existing) {
      assertExternalIdentityOwner(existing, bagId, result.bhsUid);
      if (!isExactHbssScanDuplicate(existing, bagId, expectedBhsUid, result)) {
        throw new XrayConflictError(
          "X-ray scan identity was already received with a different payload",
        );
      }
      return { scan: existing, disposition: "DUPLICATE" };
    }

    const { data, error } = await insertScan(values);
    if (!error && data) {
      return { scan: mapXrayScanRow(data), disposition: "CREATED" };
    }

    // A concurrent delivery may have inserted the same vendor identity after
    // our lookup. Resolve that race by updating the now-existing record.
    if (error?.code === "23505") {
      const concurrent = await findByExternalIdentity(result.sourceSystem, result.externalScanId);
      if (concurrent) {
        assertExternalIdentityOwner(concurrent, bagId, result.bhsUid);
        if (!isExactHbssScanDuplicate(concurrent, bagId, expectedBhsUid, result)) {
          throw new XrayConflictError(
            "X-ray scan identity was concurrently received with a different payload",
            { cause: error },
          );
        }
        return { scan: concurrent, disposition: "DUPLICATE" };
      }

      throw new XrayConflictError("X-ray scan identity conflicts with an existing record", {
        cause: error,
      });
    }

    throw new XrayPersistenceError("Unable to store the X-ray scan record", {
      cause: error ?? undefined,
    });
  },

  async saveFailure(bagId, bhsUid, error) {
    const now = new Date().toISOString();
    const sourceSystem = selectedFailureSource();
    const failure = safeFailureDetails(error);
    const values: XrayScanWrite = {
      bag_id: bagId,
      bhs_uid: bhsUid,
      external_scan_id: null,
      source_system: sourceSystem,
      status: "FAILED",
      images: [],
      threat_level: null,
      threat_type: null,
      captured_at: null,
      received_at: now,
      error_code: failure.errorCode,
      error_message: failure.errorMessage,
      metadata: { failureRecorded: true },
      updated_at: now,
    };

    const existing = await findReusableFailure(bagId, bhsUid, sourceSystem);
    if (existing) {
      return updateScan(existing.id, values);
    }

    const { data, error: insertError } = await insertScan(values);
    if (insertError || !data) {
      throw new XrayPersistenceError("Unable to store the X-ray failure record", {
        cause: insertError ?? undefined,
      });
    }

    return mapXrayScanRow(data);
  },
};

export const findSelectionByBagId = xrayRepository.findSelectionByBagId;
export const findLatestByBagId = xrayRepository.findLatestByBagId;
export const findLatestByBhsUid = xrayRepository.findLatestByBhsUid;
export const upsertFromAdapterResult = xrayRepository.upsertFromAdapterResult;
export const saveFailure = xrayRepository.saveFailure;
