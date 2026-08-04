import { MOCK_XRAY_SETS } from "@/features/simulator/mockXraySets";
import type { HbssScanResult, XrayImageView } from "@/types/xray";
import type { HbssAdapter } from "./hbssAdapter";
import { parseBhsUid, parseHbssScanResult } from "./hbssSchemas";

const MOCK_SOURCE_SYSTEM = "MOCK_HBSS";
const MOCK_CAPTURE_EPOCH = Date.UTC(2025, 0, 1, 0, 0, 0);
const MOCK_CAPTURE_WINDOW_MS = 365 * 24 * 60 * 60 * 1_000;
const MOCK_THREAT_TYPES = [
  "Dense organic material",
  "Unidentified metallic object",
  "Liquid density anomaly",
  "Manual review requested",
] as const;

function deterministicHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function externalScanIdFor(bhsUid: string, hash: number): string {
  return `MOCK-${hash.toString(16).toUpperCase().padStart(8, "0")}-${bhsUid.length}`;
}

function capturedAtFor(hash: number): string {
  return new Date(MOCK_CAPTURE_EPOCH + (hash % MOCK_CAPTURE_WINDOW_MS)).toISOString();
}

function mockImages(externalScanId: string, hash: number): XrayImageView[] {
  const imageSet = MOCK_XRAY_SETS[hash % MOCK_XRAY_SETS.length];
  if (!imageSet) {
    return [];
  }

  return imageSet.images.map((image) => ({
    id: `${externalScanId}-${image.imageId}`,
    label: image.label,
    url: image.imageRef,
    mimeType: image.mimeType,
  }));
}

function mockResultFor(bhsUidInput: string): HbssScanResult {
  const bhsUid = parseBhsUid(bhsUidInput);
  const hash = deterministicHash(bhsUid);
  const externalScanId = externalScanIdFor(bhsUid, hash);
  const sharedMetadata = {
    mockData: true,
    deterministicKey: hash.toString(16).padStart(8, "0"),
  };
  const images = mockImages(externalScanId, hash);

  if (bhsUid.includes("PENDING")) {
    return parseHbssScanResult({
      externalScanId,
      bhsUid,
      sourceSystem: MOCK_SOURCE_SYSTEM,
      status: "PENDING",
      images: [],
      metadata: sharedMetadata,
    });
  }

  if (bhsUid.includes("MISSING")) {
    return parseHbssScanResult({
      externalScanId,
      bhsUid,
      sourceSystem: MOCK_SOURCE_SYSTEM,
      status: "NOT_FOUND",
      images: [],
      metadata: sharedMetadata,
    });
  }

  if (bhsUid.includes("FAIL")) {
    return parseHbssScanResult({
      externalScanId,
      bhsUid,
      sourceSystem: MOCK_SOURCE_SYSTEM,
      status: "FAILED",
      images: [],
      metadata: {
        ...sharedMetadata,
        simulatedError: "Mock HBSS scan retrieval failure",
      },
    });
  }

  if (images.length === 0) {
    return parseHbssScanResult({
      externalScanId,
      bhsUid,
      sourceSystem: MOCK_SOURCE_SYSTEM,
      status: "NOT_FOUND",
      images: [],
      metadata: {
        ...sharedMetadata,
        simulatedError: "No user-provided mock X-ray image set is configured",
      },
    });
  }

  return parseHbssScanResult({
    externalScanId,
    bhsUid,
    sourceSystem: MOCK_SOURCE_SYSTEM,
    status: "AVAILABLE",
    images,
    threatLevel: (hash % 5) + 1,
    threatType: MOCK_THREAT_TYPES[hash % MOCK_THREAT_TYPES.length],
    capturedAt: capturedAtFor(hash),
    metadata: sharedMetadata,
  });
}

export const mockHbssAdapter: HbssAdapter = {
  name: MOCK_SOURCE_SYSTEM,

  async getScanByBhsUid(bhsUid: string, options) {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("The HBSS request was aborted", "AbortError");
    }
    return mockResultFor(bhsUid);
  },

  async healthCheck() {
    return {
      healthy: true,
      message: "Mock HBSS adapter is ready",
    };
  },
};
