import "@tanstack/react-start/server-only";

import type { TaggingBag } from "@/types/tagging";
import {
  TaggingAlreadyEncodedError,
  TaggingBagNotFoundError,
  TaggingDuplicateEpcError,
  TaggingValidationError,
} from "./taggingErrors";
import {
  taggingRepository,
  type EncodeTagCommand,
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
  };
}

export const taggingService = createTaggingService();
