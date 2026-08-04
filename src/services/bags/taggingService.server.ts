import "@tanstack/react-start/server-only";

import type { TaggingBag } from "@/types/tagging";
import type {
  TagInputKind,
  TaggingDeviceHealth,
  TaggingWorkflowResult,
} from "@/types/taggingWorkflow";
import {
  readTaggingStationConfig,
  type TaggingStationConfig,
} from "@/services/stations/stationConfig";
import {
  createTaggingDeviceSuite,
  type TaggingDeviceSuite,
} from "@/services/stations/tagging/taggingDeviceFactory.server";
import {
  TaggingAlreadyEncodedError,
  TagAssignmentConflictError,
  TaggingBagNotFoundError,
  TaggingDuplicateEpcError,
  TaggingPersistenceError,
  TaggingValidationError,
} from "./taggingErrors";
import {
  taggingRepository,
  type EncodeTagCommand,
  type AssignRfidTagCommand,
  type TaggingRepository,
} from "./taggingRepository.server";
import {
  taggingWorkflowRepository,
  type TaggingWorkflowRepository,
} from "./taggingWorkflowRepository.server";
import {
  canonicalRequestHash,
  normalizeHexEpc,
  normalizeOptionalIataLpc,
  normalizeTagBarcode,
  photoMetadataInputSchema,
  sha256Bytes,
  taggingIdentityInputSchema,
  validatePhotoSignature,
} from "./taggingWorkflowSchemas";

export interface EncodeTagInput {
  bagId: string;
  epc: string;
  actorId: string;
  canonicalRole: string;
  requestId?: string | null;
}

export interface TaggingService {
  listPendingTagging(): Promise<TaggingBag[]>;
  encodeTag(input: EncodeTagInput): Promise<TaggingBag>;
  assignRfidTag(input: AssignRfidTagInput): Promise<TaggingBag>;
  configureWorkflow(actorId: string, requestId: string): Promise<TaggingWorkflowResult>;
  syncQueueItem(input: SyncTaggingQueueItemInput): Promise<TaggingWorkflowResult>;
  createSession(input: CreateTaggingSessionInput): Promise<TaggingWorkflowResult>;
  getSession(input: GetTaggingSessionInput): Promise<TaggingWorkflowResult>;
  captureIdentity(input: CaptureTaggingIdentityInput): Promise<TaggingWorkflowResult>;
  reserveEpc(
    input: WorkflowMutationInput & { requestedEpc?: string | null },
  ): Promise<TaggingWorkflowResult>;
  encode(input: EncodeWorkflowInput): Promise<TaggingWorkflowResult>;
  verify(input: WorkflowMutationInput): Promise<TaggingWorkflowResult>;
  updateIataLpc(
    input: WorkflowMutationInput & { iataLpc?: string | null },
  ): Promise<TaggingWorkflowResult>;
  capturePhoto(input: CapturePhotoInput): Promise<TaggingWorkflowResult>;
  overridePhoto(
    input: WorkflowMutationInput & { reason: string; actorRole: string },
  ): Promise<TaggingWorkflowResult>;
  commitSession(
    input: WorkflowMutationInput & { actorRole: string },
  ): Promise<TaggingWorkflowResult>;
  cancelSession(input: WorkflowMutationInput & { reason: string }): Promise<TaggingWorkflowResult>;
  retrySession(input: WorkflowMutationInput & { reason: string }): Promise<TaggingWorkflowResult>;
  requestReplacement(input: RequestTagReplacementInput): Promise<TaggingWorkflowResult>;
  getDeviceHealth(): Promise<Record<string, TaggingDeviceHealth>>;
}

export interface WorkflowMutationInput {
  sessionId: string;
  expectedVersion: number;
  actorId: string;
  requestId: string;
}

export interface SyncTaggingQueueItemInput {
  queueItemId: string;
  bhsUid: string;
  lineId: string;
  evaluation: "R" | "T" | "N" | "?";
  position: 1 | 2;
  state: "ACTIVE" | "WAITING" | "TAGGING_IN_PROGRESS" | "JAMMED";
  localVersion: number;
  receivedAt: string;
  requestId: string;
}

export interface CreateTaggingSessionInput {
  queueItemId: string;
  actorId: string;
  actorRole: string;
  requestId: string;
}

export interface GetTaggingSessionInput {
  sessionId: string;
  actorId: string;
}

export interface CaptureTaggingIdentityInput extends WorkflowMutationInput {
  barcode: string;
  expectedEpc?: string | null;
  inputKind: TagInputKind;
  reason?: string | null;
}

export interface EncodeWorkflowInput extends WorkflowMutationInput {
  labelTemplateId?: string | null;
}

export interface CapturePhotoInput extends WorkflowMutationInput {
  actorRole: string;
  replacementReason?: string | null;
  suppliedBytes?: Uint8Array;
  suppliedMimeType?: "image/jpeg" | "image/png";
}

export interface RequestTagReplacementInput {
  assignmentId: string;
  actorId: string;
  actorRole: string;
  reason: string;
  requestId: string;
}

export interface TaggingWorkflowDependencies {
  workflowRepository?: TaggingWorkflowRepository;
  getConfig?: () => TaggingStationConfig;
  getDevices?: (configuration: TaggingStationConfig) => TaggingDeviceSuite;
}

export interface AssignRfidTagInput extends EncodeTagInput {
  rfidTagBarcode: string;
  iataLpc?: string;
  expectedVersion: number;
}

export function normalizeEpc(epcInput: string): string {
  const epc = epcInput.trim().toUpperCase();
  if (!epc) {
    throw new TaggingValidationError("EPC is required");
  }
  if (epc.length > 128) {
    throw new TaggingValidationError("EPC must not exceed 128 characters");
  }
  if (!/^[A-Z0-9][A-Z0-9._:-]*$/.test(epc)) {
    throw new TaggingValidationError(
      "EPC may only contain letters, numbers, dots, underscores, colons, and hyphens",
    );
  }
  return epc;
}

function normalizeBagId(bagIdInput: string): string {
  const bagId = bagIdInput.trim();
  if (!bagId) {
    throw new TaggingValidationError("Bag ID is required");
  }
  if (bagId.length > 128) {
    throw new TaggingValidationError("Bag ID is too long");
  }
  return bagId;
}

function normalizeBarcode(value: string): string {
  const barcode = value.trim().toUpperCase();
  if (!barcode || barcode.length > 128 || !/^[A-Z0-9][A-Z0-9._:/+-]*$/.test(barcode)) {
    throw new TaggingValidationError("RFID tag barcode contains unsupported characters");
  }
  return barcode;
}

function normalizeIataLpc(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const lpc = value.trim();
  if (!/^\d{10}$/.test(lpc))
    throw new TaggingValidationError("IATA Licence Plate Code must be 10 numeric digits");
  return lpc;
}

const SAFE_ENCODER_METADATA_KEYS = new Set([
  "logicalDeviceId",
  "encodedEpc",
  "durationMs",
  "attempt",
  "resultCode",
]);

function sanitizeEncoderMetadata(metadata: Record<string, string | number | boolean | null>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key, value]) =>
        SAFE_ENCODER_METADATA_KEYS.has(key) &&
        (value === null ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          (typeof value === "string" && value.length <= 256)),
    ),
  );
}

export function createTaggingService(
  repository: TaggingRepository = taggingRepository,
  workflowDependencies: TaggingWorkflowDependencies = {},
): TaggingService {
  const workflow = workflowDependencies.workflowRepository ?? taggingWorkflowRepository;
  const getConfig = workflowDependencies.getConfig ?? (() => readTaggingStationConfig());
  let cachedDevices: TaggingDeviceSuite | null = null;
  const getDevices = () => {
    const configuration = getConfig();
    cachedDevices ??=
      workflowDependencies.getDevices?.(configuration) ?? createTaggingDeviceSuite(configuration);
    return { configuration, devices: cachedDevices };
  };

  const invokeMutation = (
    functionName: string,
    parameters: Record<string, unknown>,
    payload: unknown,
  ) =>
    workflow.invoke(functionName, {
      ...parameters,
      p_payload_hash: canonicalRequestHash(payload),
    });
  const getWorkflowSession = (input: GetTaggingSessionInput) => {
    const configuration = getConfig();
    return workflow.invoke("get_tagging_session_v1", {
      p_session_id: input.sessionId,
      p_site_id: configuration.siteId,
      p_station_id: configuration.stationId,
      p_operator_id: input.actorId,
    });
  };

  return {
    async listPendingTagging() {
      const bags = await repository.listPendingTagging();
      return bags
        .filter((bag) => bag.status === "IDENTIFIED")
        .sort((first, second) => {
          const timeDifference =
            new Date(first.flaggedAt).getTime() - new Date(second.flaggedAt).getTime();
          return timeDifference === 0 ? first.id.localeCompare(second.id) : timeDifference;
        });
    },

    async encodeTag(input) {
      const command: EncodeTagCommand = {
        bagId: normalizeBagId(input.bagId),
        epc: normalizeEpc(input.epc),
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        requestId: input.requestId?.trim() || null,
      };
      const result = await repository.encodeTagAtomic(command);

      switch (result.status) {
        case "ENCODED":
          return result.bag;
        case "INVALID_BAG_ID":
        case "INVALID_EPC":
          throw new TaggingValidationError(result.errorMessage ?? "Invalid RFID encoding input");
        case "BAG_NOT_FOUND":
          throw new TaggingBagNotFoundError(result.errorMessage);
        case "ALREADY_TAGGED":
          throw new TaggingAlreadyEncodedError(result.errorMessage);
        case "DUPLICATE_EPC":
          throw new TaggingDuplicateEpcError(result.errorMessage);
        case "TAG_ASSIGNMENT_NOT_READY":
          throw new TagAssignmentConflictError(
            result.errorMessage ?? "Bag is not ready for RFID tag assignment",
            "TAG_ASSIGNMENT_NOT_READY",
          );
      }
    },

    async assignRfidTag(input) {
      const command: AssignRfidTagCommand = {
        bagId: normalizeBagId(input.bagId),
        epc: normalizeEpc(input.epc),
        rfidTagBarcode: normalizeBarcode(input.rfidTagBarcode),
        iataLpc: normalizeIataLpc(input.iataLpc),
        expectedVersion: input.expectedVersion,
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        requestId: input.requestId?.trim() || null,
      };
      if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
        throw new TaggingValidationError("Expected bag version is required");
      }
      const result = await repository.assignRfidTagAtomic(command);
      if (result.status === "ASSIGNED") return result.bag;
      if (result.status === "BAG_NOT_FOUND") throw new TaggingBagNotFoundError(result.errorMessage);
      if (
        result.status === "INVALID_BAG_ID" ||
        result.status === "INVALID_EPC" ||
        result.status === "INVALID_BARCODE" ||
        result.status === "INVALID_LPC" ||
        result.status === "INVALID_VERSION"
      ) {
        throw new TaggingValidationError(
          result.errorMessage ?? "Invalid RFID tag assignment input",
        );
      }
      const errors = {
        BHS_UID_REQUIRED: [
          "BHS BagID is required before RFID tag assignment",
          "TAG_ASSIGNMENT_BHS_UID_REQUIRED",
        ],
        TAG_ASSIGNMENT_BHS_CONFIRMATION_REQUIRED: [
          "BHS diversion confirmation is required before assigning an RFID tag",
          "TAG_ASSIGNMENT_BHS_CONFIRMATION_REQUIRED",
        ],
        TAG_ASSIGNMENT_NOT_READY: [
          "Required BHS, screening, threat, and X-ray evidence is incomplete",
          "TAG_ASSIGNMENT_NOT_READY",
        ],
        BAG_INELIGIBLE: [
          "Bag is no longer eligible for RFID tag assignment",
          "TAG_ASSIGNMENT_BAG_INELIGIBLE",
        ],
        DUPLICATE_EPC: ["EPC is already assigned to another bag", "TAG_ASSIGNMENT_EPC_CONFLICT"],
        DUPLICATE_BARCODE: [
          "RFID tag barcode is already assigned to another bag",
          "TAG_ASSIGNMENT_BARCODE_CONFLICT",
        ],
        VERSION_CONFLICT: [
          "Bag changed by another operator. Refresh and review it.",
          "TAG_ASSIGNMENT_VERSION_CONFLICT",
        ],
      } as const;
      const [message, code] = errors[result.status];
      throw new TagAssignmentConflictError(result.errorMessage ?? message, code);
    },

    async configureWorkflow(actorId, requestId) {
      const configuration = getConfig();
      return workflow.invoke("configure_tagging_station_v1", {
        p_site_id: configuration.siteId,
        p_station_id: configuration.stationId,
        p_allowed_line_ids: configuration.allowedLineIds,
        p_provisioning_mode: configuration.provisioningMode,
        p_photo_policy: configuration.bagPhotoPolicy,
        p_verification_required_preencoded: configuration.verificationRequiredPreencoded,
        p_stable_read_count: configuration.verificationStableReadCount,
        p_epc_allowed_bit_lengths: configuration.epcAllowedBitLengths,
        p_manual_barcode_entry: configuration.manualBarcodeEntry,
        p_manual_epc_entry: configuration.manualEpcEntry,
        p_inventory_enabled: configuration.inventoryEnabled,
        p_simulation_enabled: configuration.taggingSimulationEnabled,
        p_session_ttl_seconds: configuration.taggingSessionTtlSeconds,
        p_photo_max_bytes: configuration.bagPhotoMaxBytes,
        p_actor_id: actorId,
        p_request_id: requestId,
      });
    },

    async syncQueueItem(input) {
      const configuration = getConfig();
      return workflow.invoke("sync_tagging_station_queue_item_v1", {
        p_queue_item_id: input.queueItemId,
        p_site_id: configuration.siteId,
        p_station_id: configuration.stationId,
        p_bhs_uid: input.bhsUid,
        p_line_id: input.lineId,
        p_evaluation: input.evaluation,
        p_position: input.position,
        p_state: input.state,
        p_local_version: input.localVersion,
        p_received_at: input.receivedAt,
        p_request_id: input.requestId,
      });
    },

    async createSession(input) {
      const { devices } = getDevices();
      const payload = { queueItemId: input.queueItemId, actorId: input.actorId };
      return invokeMutation(
        "create_tagging_session_v1",
        {
          p_queue_item_id: input.queueItemId,
          p_operator_id: input.actorId,
          p_operator_role: input.actorRole,
          p_request_id: input.requestId,
          p_is_simulated: devices.simulated,
        },
        payload,
      );
    },

    async getSession(input) {
      return getWorkflowSession(input);
    },

    async captureIdentity(input) {
      const configuration = getConfig();
      const parsed = taggingIdentityInputSchema.parse({
        sessionId: input.sessionId,
        barcode: input.barcode,
        expectedEpc: input.expectedEpc,
        inputKind: input.inputKind,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        requestId: input.requestId,
      });
      if (parsed.inputKind === "MANUAL" && !configuration.manualBarcodeEntry) {
        throw new TaggingValidationError("Manual RFID barcode entry is disabled");
      }
      const barcode = normalizeTagBarcode(parsed.barcode, parsed.inputKind);
      const expectedEpc = parsed.expectedEpc
        ? normalizeHexEpc(parsed.expectedEpc, {
            allowedBitLengths: configuration.epcAllowedBitLengths,
            canonicalCase: configuration.epcCanonicalCase,
          })
        : null;
      const payload = { ...parsed, barcode, expectedEpc };
      return invokeMutation(
        "capture_tagging_identity_v1",
        {
          p_session_id: parsed.sessionId,
          p_barcode: barcode,
          p_expected_epc: expectedEpc,
          p_input_kind: parsed.inputKind,
          p_reason: parsed.reason ?? null,
          p_expected_version: parsed.expectedVersion,
          p_actor_id: input.actorId,
          p_request_id: parsed.requestId,
        },
        payload,
      );
    },

    async reserveEpc(input) {
      const configuration = getConfig();
      const requestedEpc = input.requestedEpc
        ? normalizeHexEpc(input.requestedEpc, {
            allowedBitLengths: configuration.epcAllowedBitLengths,
            canonicalCase: configuration.epcCanonicalCase,
          })
        : null;
      const payload = { sessionId: input.sessionId, requestedEpc };
      return invokeMutation(
        "reserve_tagging_epc_v1",
        {
          p_session_id: input.sessionId,
          p_requested_epc: requestedEpc,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_request_id: input.requestId,
        },
        payload,
      );
    },

    async encode(input) {
      const { configuration, devices } = getDevices();
      const startPayload = {
        sessionId: input.sessionId,
        logicalDeviceId: configuration.rfidEncoderLogicalDeviceId,
        labelTemplateId: input.labelTemplateId ?? null,
      };
      const started = await invokeMutation(
        "start_tagging_encode_v1",
        {
          p_session_id: input.sessionId,
          p_logical_device_id: configuration.rfidEncoderLogicalDeviceId,
          p_label_template_id: input.labelTemplateId ?? null,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_request_id: `${input.requestId}:start`,
        },
        startPayload,
      );
      if (started.status !== "ENCODING" && started.status !== "DUPLICATE") return started;
      if (!started.job || !started.session?.expectedEpc) return started;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), configuration.encodeTimeoutMs);
      let deviceResult;
      try {
        deviceResult = await devices.encoder.encode(
          {
            jobId: started.job.id,
            sessionId: started.session.id,
            epc: started.session.expectedEpc,
            barcode: started.session.rfidTagBarcode,
            labelTemplateId: input.labelTemplateId ?? null,
            logicalDeviceId: configuration.rfidEncoderLogicalDeviceId,
          },
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
      const safeMetadata = sanitizeEncoderMetadata(deviceResult.metadata);
      const completionPayload = {
        jobId: started.job.id,
        result: deviceResult.status,
        failureCode: deviceResult.failureCode,
        metadata: safeMetadata,
      };
      return invokeMutation(
        "complete_tagging_encode_v1",
        {
          p_job_id: started.job.id,
          p_result: deviceResult.status,
          p_failure_code: deviceResult.failureCode,
          p_sanitized_result: safeMetadata,
          p_expected_session_version: started.session.version,
          p_actor_id: input.actorId,
          p_request_id: `${input.requestId}:complete`,
        },
        completionPayload,
      );
    },

    async verify(input) {
      const { configuration, devices } = getDevices();
      const current = await getWorkflowSession({
        sessionId: input.sessionId,
        actorId: input.actorId,
      });
      if (!current.session?.expectedEpc) return current;
      if (current.session.version !== input.expectedVersion) {
        return { status: "VERSION_CONFLICT", session: current.session };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), configuration.verificationTimeoutMs);
      let deviceResult;
      try {
        deviceResult = await devices.verifier.verify(
          {
            sessionId: current.session.id,
            expectedEpc: current.session.expectedEpc,
            barcode: current.session.rfidTagBarcode,
            logicalDeviceId: configuration.rfidVerifierLogicalDeviceId,
            timeoutMs: configuration.verificationTimeoutMs,
            requiredStableReadCount: current.session.requiredStableReadCount,
          },
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
      const payload = {
        sessionId: input.sessionId,
        result: deviceResult.result,
        observedEpcs: deviceResult.observedEpcs,
        stableReadCount: deviceResult.stableReadCount,
      };
      return invokeMutation(
        "record_tagging_verification_v1",
        {
          p_session_id: input.sessionId,
          p_logical_device_id: configuration.rfidVerifierLogicalDeviceId,
          p_observed_epcs: deviceResult.observedEpcs,
          p_stable_read_count: deviceResult.stableReadCount,
          p_result: deviceResult.result,
          p_failure_code: deviceResult.failureCode,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_request_id: input.requestId,
          p_is_simulated: deviceResult.simulated,
        },
        payload,
      );
    },

    async updateIataLpc(input) {
      const iataLpc = normalizeOptionalIataLpc(input.iataLpc);
      const payload = { sessionId: input.sessionId, iataLpc };
      return invokeMutation(
        "update_tagging_lpc_v1",
        {
          p_session_id: input.sessionId,
          p_iata_lpc: iataLpc,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_request_id: input.requestId,
        },
        payload,
      );
    },

    async capturePhoto(input) {
      const { configuration, devices } = getDevices();
      const current = await getWorkflowSession({
        sessionId: input.sessionId,
        actorId: input.actorId,
      });
      if (!current.session) return current;
      if (current.session.version !== input.expectedVersion) {
        return { status: "VERSION_CONFLICT", session: current.session };
      }
      const previousStaged = await workflow.getStagedPhoto(input.sessionId);
      const controller = new AbortController();
      await devices.camera.start(controller.signal);
      const capture = await devices.camera.capture(
        {
          sessionId: current.session.id,
          bagId: current.session.bagId,
          bhsUid: current.session.bhsUid,
          maximumBytes: configuration.bagPhotoMaxBytes,
          suppliedBytes: input.suppliedBytes,
          suppliedMimeType: input.suppliedMimeType,
        },
        controller.signal,
      );
      validatePhotoSignature(capture.bytes, capture.mimeType);
      const checksum = sha256Bytes(capture.bytes);
      const metadata = photoMetadataInputSchema.parse({
        originalMimeType: capture.mimeType,
        storedMimeType: capture.mimeType,
        width: capture.width,
        height: capture.height,
        fileSize: capture.bytes.byteLength,
        checksumSha256: checksum,
      });
      const staged = await devices.photoStorage.stage(
        {
          siteId: current.session.siteId,
          stationId: current.session.stationId,
          sessionId: current.session.id,
          checksumSha256: checksum,
          mimeType: capture.mimeType,
          bytes: capture.bytes,
        },
        controller.signal,
      );
      const payload = {
        sessionId: input.sessionId,
        ...metadata,
        storageKey: staged.storageKey,
        replacementReason: input.replacementReason ?? null,
      };
      try {
        const result = await invokeMutation(
          "stage_tagging_bag_photo_v1",
          {
            p_session_id: input.sessionId,
            p_storage_key: staged.storageKey,
            p_original_mime_type: metadata.originalMimeType,
            p_stored_mime_type: metadata.storedMimeType,
            p_width: metadata.width,
            p_height: metadata.height,
            p_file_size: metadata.fileSize,
            p_checksum_sha256: metadata.checksumSha256,
            p_captured_at: capture.capturedAt,
            p_expected_version: input.expectedVersion,
            p_actor_id: input.actorId,
            p_request_id: input.requestId,
            p_actor_role: input.actorRole,
            p_replacement_reason: input.replacementReason ?? null,
            p_is_simulated: capture.simulated,
          },
          payload,
        );
        if (result.status === "STAGED" && previousStaged) {
          const abandonedKey =
            result.photo?.id === previousStaged.id ? staged.storageKey : previousStaged.storageKey;
          await devices.photoStorage.abandon(abandonedKey).catch(() => undefined);
        } else if (result.status !== "STAGED") {
          await devices.photoStorage.abandon(staged.storageKey).catch(() => undefined);
        }
        return result;
      } catch (error) {
        await devices.photoStorage.abandon(staged.storageKey);
        throw error;
      }
    },

    async overridePhoto(input) {
      const payload = { sessionId: input.sessionId, reason: input.reason };
      return invokeMutation(
        "override_tagging_photo_v1",
        {
          p_session_id: input.sessionId,
          p_reason: input.reason,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_actor_role: input.actorRole,
          p_request_id: input.requestId,
        },
        payload,
      );
    },

    async commitSession(input) {
      const { devices } = getDevices();
      const payload = { sessionId: input.sessionId, expectedVersion: input.expectedVersion };
      const committed = await invokeMutation(
        "commit_tagging_session_v1",
        {
          p_session_id: input.sessionId,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_actor_role: input.actorRole,
          p_request_id: input.requestId,
        },
        payload,
      );
      if (!["COMMITTED", "DUPLICATE"].includes(committed.status)) return committed;
      const staged = await workflow.getStagedPhoto(input.sessionId);
      if (!staged) return committed;
      const finalizePayload = { sessionId: input.sessionId, photoId: staged.id };
      try {
        await devices.photoStorage.promote(staged.storageKey);
        const finalized = await invokeMutation(
          "finalize_tagging_photo_v1",
          {
            p_session_id: input.sessionId,
            p_photo_id: staged.id,
            p_actor_id: input.actorId,
            p_request_id: `${input.requestId}:photo-finalize`,
          },
          finalizePayload,
        );
        return {
          ...committed,
          session: finalized.session ?? committed.session,
          photo: finalized.photo ?? committed.photo,
        };
      } catch (error) {
        const failureCode = "BAG_PHOTO_PROMOTION_FAILED";
        await invokeMutation(
          "record_tagging_photo_promotion_failure_v1",
          {
            p_session_id: input.sessionId,
            p_photo_id: staged.id,
            p_failure_code: failureCode,
            p_actor_id: input.actorId,
            p_request_id: `${input.requestId}:photo-failure`,
          },
          { ...finalizePayload, failureCode },
        );
        throw new TaggingPersistenceError(failureCode, { cause: error });
      }
    },

    async cancelSession(input) {
      return invokeMutation(
        "cancel_tagging_session_v1",
        {
          p_session_id: input.sessionId,
          p_reason: input.reason,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_request_id: input.requestId,
        },
        { sessionId: input.sessionId, reason: input.reason },
      );
    },

    async retrySession(input) {
      return invokeMutation(
        "retry_failed_tagging_session_v1",
        {
          p_session_id: input.sessionId,
          p_reason: input.reason,
          p_expected_version: input.expectedVersion,
          p_actor_id: input.actorId,
          p_request_id: input.requestId,
        },
        { sessionId: input.sessionId, reason: input.reason },
      );
    },

    async requestReplacement(input) {
      const { devices } = getDevices();
      return invokeMutation(
        "request_tag_replacement_v1",
        {
          p_assignment_id: input.assignmentId,
          p_operator_id: input.actorId,
          p_operator_role: input.actorRole,
          p_reason: input.reason,
          p_request_id: input.requestId,
          p_is_simulated: devices.simulated,
        },
        { assignmentId: input.assignmentId, reason: input.reason },
      );
    },

    async getDeviceHealth() {
      const { devices } = getDevices();
      const [tagInput, encoder, verifier, camera, photoStorage] = await Promise.all([
        devices.tagInput.getHealth(),
        devices.encoder.getHealth(),
        devices.verifier.getHealth(),
        devices.camera.getHealth(),
        devices.photoStorage.getHealth(),
      ]);
      return { tagInput, encoder, verifier, camera, photoStorage };
    },
  };
}

export const taggingService = createTaggingService();
