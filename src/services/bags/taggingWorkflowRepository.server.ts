import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import type {
  BagPhotoMetadata,
  BagTagAssignment,
  EpcReservation,
  TagProvisioningJob,
  TagVerificationAttempt,
  TaggingSession,
  TaggingWorkflowResult,
} from "@/types/taggingWorkflow";
import { TaggingPersistenceError } from "./taggingErrors";

const rpcResultSchema = z
  .object({
    status: z.string().min(1),
    errorCode: z.string().nullable().optional(),
    session: z.record(z.unknown()).optional(),
    reservation: z.record(z.unknown()).optional(),
    job: z.record(z.unknown()).optional(),
    attempt: z.record(z.unknown()).optional(),
    photo: z.record(z.unknown()).optional(),
    assignment: z.record(z.unknown()).optional(),
    bag: z.unknown().optional(),
  })
  .passthrough();

const stagedPhotoSchema = z.object({
  id: z.string().uuid(),
  tagging_session_id: z.string().uuid(),
  storage_key: z.string().min(1),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.literal("STAGED"),
});

function requiredString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${key}`);
  return value;
}

function nullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Invalid ${key}`);
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${key}`);
  return value;
}

function mapSession(row: Record<string, unknown>): TaggingSession {
  return {
    id: requiredString(row, "id"),
    siteId: requiredString(row, "site_id"),
    stationId: requiredString(row, "station_id"),
    queueItemId: requiredString(row, "queue_item_id"),
    bagId: requiredString(row, "bag_id"),
    bhsUid: requiredString(row, "bhs_uid"),
    lineId: requiredString(row, "line_id"),
    operatorId: requiredString(row, "operator_id"),
    operatorRole: requiredString(row, "operator_role"),
    state: requiredString(row, "state") as TaggingSession["state"],
    provisioningMode: requiredString(
      row,
      "provisioning_mode",
    ) as TaggingSession["provisioningMode"],
    configurationVersion: requiredNumber(row, "configuration_version"),
    rfidTagBarcode: nullableString(row, "rfid_tag_barcode"),
    expectedEpc: nullableString(row, "expected_epc"),
    verifiedEpc: nullableString(row, "verified_epc"),
    iataLpc: nullableString(row, "iata_lpc"),
    photoPolicy: requiredString(row, "photo_policy") as TaggingSession["photoPolicy"],
    photoStatus: requiredString(row, "photo_status") as TaggingSession["photoStatus"],
    photoOverrideReason: nullableString(row, "photo_override_reason"),
    verificationRequired: row.verification_required === true,
    requiredStableReadCount: requiredNumber(row, "required_stable_read_count"),
    failureCode: nullableString(row, "failure_code"),
    failureDetail: nullableString(row, "failure_detail"),
    replacementOfAssignmentId: nullableString(row, "replacement_of_assignment_id"),
    version: requiredNumber(row, "version"),
    simulated: row.is_simulated === true,
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
    expiresAt: requiredString(row, "expires_at"),
    committedAt: nullableString(row, "committed_at"),
    cancelledAt: nullableString(row, "cancelled_at"),
  };
}

function mapReservation(row: Record<string, unknown>): EpcReservation {
  return {
    id: requiredString(row, "id"),
    sessionId: requiredString(row, "session_id"),
    epc: requiredString(row, "epc"),
    status: requiredString(row, "status") as EpcReservation["status"],
    expiresAt: requiredString(row, "expires_at"),
    failureCode: nullableString(row, "failure_code"),
  };
}

function mapJob(row: Record<string, unknown>): TagProvisioningJob {
  return {
    id: requiredString(row, "id"),
    sessionId: requiredString(row, "session_id"),
    reservationId: requiredString(row, "reservation_id"),
    logicalDeviceId: requiredString(row, "logical_device_id"),
    epc: requiredString(row, "epc"),
    status: requiredString(row, "status") as TagProvisioningJob["status"],
    failureCode: nullableString(row, "failure_code"),
    retryCount: requiredNumber(row, "retry_count"),
    requestedAt: requiredString(row, "requested_at"),
    startedAt: nullableString(row, "started_at"),
    completedAt: nullableString(row, "completed_at"),
  };
}

function mapAttempt(row: Record<string, unknown>): TagVerificationAttempt {
  return {
    id: requiredString(row, "id"),
    sessionId: requiredString(row, "session_id"),
    expectedEpc: requiredString(row, "expected_epc"),
    observedEpcs: Array.isArray(row.observed_epcs)
      ? row.observed_epcs.filter((value): value is string => typeof value === "string")
      : [],
    stableReadCount: requiredNumber(row, "stable_read_count"),
    result: requiredString(row, "result") as TagVerificationAttempt["result"],
    failureCode: nullableString(row, "failure_code"),
    simulated: row.is_simulated === true,
    startedAt: requiredString(row, "started_at"),
    completedAt: requiredString(row, "completed_at"),
  };
}

function mapPhoto(row: Record<string, unknown>): BagPhotoMetadata {
  return {
    id: requiredString(row, "id"),
    bagId: requiredString(row, "bag_id"),
    bhsUid: requiredString(row, "bhs_uid"),
    taggingSessionId: requiredString(row, "tagging_session_id"),
    siteId: requiredString(row, "site_id"),
    stationId: requiredString(row, "station_id"),
    capturedBy: requiredString(row, "captured_by"),
    capturedAt: requiredString(row, "captured_at"),
    originalMimeType: requiredString(
      row,
      "original_mime_type",
    ) as BagPhotoMetadata["originalMimeType"],
    storedMimeType: requiredString(row, "stored_mime_type") as BagPhotoMetadata["storedMimeType"],
    width: requiredNumber(row, "width"),
    height: requiredNumber(row, "height"),
    fileSize: requiredNumber(row, "file_size"),
    checksumSha256: requiredString(row, "checksum_sha256"),
    status: requiredString(row, "status") as BagPhotoMetadata["status"],
    version: requiredNumber(row, "version"),
    simulated: row.is_simulated === true,
  };
}

function mapAssignment(row: Record<string, unknown>): BagTagAssignment {
  return {
    id: requiredString(row, "id"),
    bagId: requiredString(row, "bag_id"),
    tagId: requiredString(row, "tag_id"),
    assignmentVersion: requiredNumber(row, "assignment_version"),
    assignmentStatus: requiredString(
      row,
      "assignment_status",
    ) as BagTagAssignment["assignmentStatus"],
    assignedAt: requiredString(row, "assigned_at"),
    assignedBy: requiredString(row, "assigned_by"),
    siteId: requiredString(row, "site_id"),
    stationId: requiredString(row, "station_id"),
    taggingSessionId: nullableString(row, "tagging_session_id"),
    replacedAssignmentId: nullableString(row, "replaced_assignment_id"),
    endedAt: nullableString(row, "ended_at"),
    endReason: nullableString(row, "end_reason"),
  };
}

function mapResult(input: unknown): TaggingWorkflowResult {
  const parsed = rpcResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new TaggingPersistenceError("Tagging workflow returned invalid data", {
      cause: parsed.error,
    });
  }
  try {
    return {
      ...parsed.data,
      errorCode: parsed.data.errorCode,
      session: parsed.data.session ? mapSession(parsed.data.session) : undefined,
      reservation: parsed.data.reservation ? mapReservation(parsed.data.reservation) : undefined,
      job: parsed.data.job ? mapJob(parsed.data.job) : undefined,
      attempt: parsed.data.attempt ? mapAttempt(parsed.data.attempt) : undefined,
      photo: parsed.data.photo ? mapPhoto(parsed.data.photo) : undefined,
      assignment: parsed.data.assignment ? mapAssignment(parsed.data.assignment) : undefined,
    };
  } catch (error) {
    throw new TaggingPersistenceError("Tagging workflow row mapping failed", { cause: error });
  }
}

export interface StagedPhotoReference {
  id: string;
  storageKey: string;
  checksumSha256: string;
}

export interface TaggingWorkflowRepository {
  invoke(functionName: string, parameters: Record<string, unknown>): Promise<TaggingWorkflowResult>;
  getStagedPhoto(sessionId: string): Promise<StagedPhotoReference | null>;
}

export const taggingWorkflowRepository: TaggingWorkflowRepository = {
  async invoke(functionName, parameters) {
    const { data, error } = await getXrayAdminClient().rpc(functionName, parameters);
    if (error) {
      throw new TaggingPersistenceError(`Tagging workflow operation ${functionName} failed`, {
        cause: error,
      });
    }
    return mapResult(data);
  },

  async getStagedPhoto(sessionId) {
    const { data, error } = await getXrayAdminClient()
      .from("bag_photos")
      .select("id,tagging_session_id,storage_key,checksum_sha256,status")
      .eq("tagging_session_id", sessionId)
      .eq("status", "STAGED")
      .maybeSingle();
    if (error) {
      throw new TaggingPersistenceError("Unable to load the staged bag photo", { cause: error });
    }
    if (!data) return null;
    const parsed = stagedPhotoSchema.safeParse(data);
    if (!parsed.success) {
      throw new TaggingPersistenceError("Stored staged bag photo is invalid", {
        cause: parsed.error,
      });
    }
    return {
      id: parsed.data.id,
      storageKey: parsed.data.storage_key,
      checksumSha256: parsed.data.checksum_sha256,
    };
  },
};
