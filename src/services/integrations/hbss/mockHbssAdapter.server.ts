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

function mockImages(externalScanId: string): XrayImageView[] {
  return [
    {
      id: `${externalScanId}-SIDE`,
      label: "Side view",
      url: "/mock-xray/scan-side.svg",
      mimeType: "image/svg+xml",
    },
    {
      id: `${externalScanId}-TOP`,
      label: "Top view",
      url: "/mock-xray/scan-top.svg",
      mimeType: "image/svg+xml",
    },
    {
      id: `${externalScanId}-DENSITY`,
      label: "Density view",
      url: "/mock-xray/scan-density.svg",
      mimeType: "image/svg+xml",
    },
  ];
}

function mockResultFor(bhsUidInput: string): HbssScanResult {
  const bhsUid = parseBhsUid(bhsUidInput).toUpperCase();
  const hash = deterministicHash(bhsUid);
  const externalScanId = externalScanIdFor(bhsUid, hash);
  const sharedMetadata = {
    mockData: true,
    deterministicKey: hash.toString(16).padStart(8, "0"),
  };

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

  return parseHbssScanResult({
    externalScanId,
    bhsUid,
    sourceSystem: MOCK_SOURCE_SYSTEM,
    status: "AVAILABLE",
    images: mockImages(externalScanId),
    threatLevel: (hash % 5) + 1,
    threatType: MOCK_THREAT_TYPES[hash % MOCK_THREAT_TYPES.length],
    capturedAt: capturedAtFor(hash),
    metadata: sharedMetadata,
  });
}

export const mockHbssAdapter: HbssAdapter = {
  name: MOCK_SOURCE_SYSTEM,

  async getScanByBhsUid(bhsUid: string) {
    return mockResultFor(bhsUid);
  },

  async healthCheck() {
    return {
      healthy: true,
      message: "Mock HBSS adapter is ready",
    };
  },
};
