import "@tanstack/react-start/server-only";

import type { TaggingBag } from "@/types/tagging";
import {
  TaggingAlreadyEncodedError,
  TagAssignmentConflictError,
  TaggingBagNotFoundError,
  TaggingDuplicateEpcError,
  TaggingValidationError,
} from "./taggingErrors";
import {
  taggingRepository,
  type EncodeTagCommand,
  type AssignRfidTagCommand,
  type TaggingRepository,
} from "./taggingRepository.server";

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

export function createTaggingService(
  repository: TaggingRepository = taggingRepository,
): TaggingService {
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
  };
}

export const taggingService = createTaggingService();
