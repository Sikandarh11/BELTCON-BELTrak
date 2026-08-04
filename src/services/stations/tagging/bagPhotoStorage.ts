import { randomUUID } from "node:crypto";

import type { TaggingDeviceHealth } from "@/types/taggingWorkflow";

export interface BagPhotoStorageUpload {
  siteId: string;
  stationId: string;
  sessionId: string;
  checksumSha256: string;
  mimeType: "image/jpeg" | "image/png";
  bytes: Uint8Array;
}

export interface StagedBagPhotoObject {
  storageKey: string;
  checksumSha256: string;
  fileSize: number;
  mimeType: "image/jpeg" | "image/png";
}

export interface BagPhotoStorage {
  stage(input: BagPhotoStorageUpload, signal: AbortSignal): Promise<StagedBagPhotoObject>;
  promote(storageKey: string): Promise<void>;
  abandon(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getHealth(): Promise<TaggingDeviceHealth>;
}

type StoredObject = StagedBagPhotoObject & {
  bytes: Uint8Array;
  status: "STAGED" | "ACTIVE" | "ABANDONED";
};

export class SimulatedBagPhotoStorage implements BagPhotoStorage {
  private readonly objects = new Map<string, StoredObject>();
  private failure: string | null = null;
  constructor(private readonly logicalDeviceId = "SIMULATED-BAG-PHOTO-STORAGE") {}
  failNextOperation(code: string) {
    this.failure = code;
  }
  private consumeFailure() {
    const failure = this.failure;
    this.failure = null;
    if (failure) throw new Error(failure);
  }
  async stage(input: BagPhotoStorageUpload, signal: AbortSignal) {
    this.consumeFailure();
    if (signal.aborted) throw new Error("BAG_PHOTO_UPLOAD_CANCELLED");
    const extension = input.mimeType === "image/jpeg" ? "jpg" : "png";
    const storageKey = `tagging-staging/${input.siteId}/${input.stationId}/${input.sessionId}/${randomUUID()}.${extension}`;
    const value: StoredObject = {
      storageKey,
      checksumSha256: input.checksumSha256,
      fileSize: input.bytes.byteLength,
      mimeType: input.mimeType,
      bytes: Uint8Array.from(input.bytes),
      status: "STAGED",
    };
    this.objects.set(storageKey, value);
    return {
      storageKey,
      checksumSha256: value.checksumSha256,
      fileSize: value.fileSize,
      mimeType: value.mimeType,
    };
  }
  async promote(storageKey: string) {
    this.consumeFailure();
    const object = this.objects.get(storageKey);
    if (!object || object.status === "ABANDONED")
      throw new Error("BAG_PHOTO_STORAGE_OBJECT_MISSING");
    object.status = "ACTIVE";
  }
  async abandon(storageKey: string) {
    const object = this.objects.get(storageKey);
    if (object && object.status !== "ACTIVE") object.status = "ABANDONED";
  }
  async exists(storageKey: string) {
    return this.objects.has(storageKey) && this.objects.get(storageKey)?.status !== "ABANDONED";
  }
  async getHealth(): Promise<TaggingDeviceHealth> {
    return { state: "READY", code: null, logicalDeviceId: this.logicalDeviceId, simulated: true };
  }
}

export class UnavailableBagPhotoStorage implements BagPhotoStorage {
  constructor(private readonly logicalDeviceId = "UNCONFIGURED-BAG-PHOTO-STORAGE") {}
  async stage(_input: BagPhotoStorageUpload, _signal: AbortSignal): Promise<StagedBagPhotoObject> {
    throw new Error("BAG_PHOTO_STORAGE_UNAVAILABLE");
  }
  async promote(_storageKey: string) {
    throw new Error("BAG_PHOTO_STORAGE_UNAVAILABLE");
  }
  async abandon(_storageKey: string) {}
  async exists(_storageKey: string) {
    return false;
  }
  async getHealth(): Promise<TaggingDeviceHealth> {
    return {
      state: "UNAVAILABLE",
      code: "BAG_PHOTO_STORAGE_UNAVAILABLE",
      logicalDeviceId: this.logicalDeviceId,
      simulated: false,
    };
  }
}
