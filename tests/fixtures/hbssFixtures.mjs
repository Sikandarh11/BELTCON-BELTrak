import { TEST_NOW } from "./bagFixtures.mjs";

export function createXrayImage(overrides = {}) {
  return {
    imageId: "XRAY-IMAGE-P1-001",
    view: "TOP",
    label: "Top view",
    imageRef: "/mock-xray/scan-top.svg",
    mimeType: "image/png",
    ...overrides,
  };
}

export function createHbssScan(overrides = {}) {
  return {
    externalScanId: "HBSS-SCAN-P1-001",
    bhsUid: "BHS0000001",
    sourceSystem: "MOCK_HBSS",
    status: "AVAILABLE",
    images: [
      {
        id: "XRAY-IMAGE-P1-001",
        label: "Top view",
        url: "/mock-xray/scan-top.svg",
        mimeType: "image/png",
      },
    ],
    threatLevel: 3,
    threatType: "SIMULATED_TEST_ANOMALY",
    capturedAt: TEST_NOW,
    metadata: { fixture: true, containsPassengerData: false },
    ...overrides,
  };
}

export const HBSS_FIXTURE_BHS_UID_A = "1234567890";
export const HBSS_FIXTURE_BHS_UID_B = "0987654321";
export const HBSS_FIXTURE_SOURCE = "SMITHS-HBSS-01";
export const HBSS_FIXTURE_SITE = "RUH";

export function createHbssImageView(overrides = {}) {
  return {
    id: "IMAGE-001",
    label: "Side view",
    url: "/mock-xray/scan-000001-side.jpg",
    mimeType: "image/jpeg",
    ...overrides,
  };
}

export function createCanonicalHbssScan(overrides = {}) {
  return {
    externalScanId: "SCAN-000001",
    bhsUid: HBSS_FIXTURE_BHS_UID_A,
    sourceSystem: HBSS_FIXTURE_SOURCE,
    status: "AVAILABLE",
    capturedAt: "2026-08-02T10:00:00.000Z",
    threatLevel: 4,
    threatType: "PROHIBITED_ITEM",
    images: [createHbssImageView()],
    metadata: { fixture: "P2-HBSS", containsPassengerData: false },
    ...overrides,
  };
}

const availableMultipleImages = createCanonicalHbssScan({
  externalScanId: "SCAN-000002",
  images: [
    createHbssImageView(),
    createHbssImageView({
      id: "IMAGE-002",
      label: "Top view",
      url: "/mock-xray/scan-000002-top.png",
      mimeType: "image/png",
    }),
  ],
});

const duplicateExternalScanId = createCanonicalHbssScan();

export const HBSS_SCAN_FIXTURES = Object.freeze({
  availableSingleImage: createCanonicalHbssScan(),
  availableMultipleImages,
  pending: createCanonicalHbssScan({
    externalScanId: "SCAN-000003",
    status: "PENDING",
    images: [],
  }),
  missing: createCanonicalHbssScan({
    externalScanId: "SCAN-000004",
    status: "NOT_FOUND",
    images: [],
  }),
  failed: createCanonicalHbssScan({
    externalScanId: "SCAN-000005",
    status: "FAILED",
    images: [],
  }),
  archived: createCanonicalHbssScan({
    externalScanId: "SCAN-000006",
    status: "ARCHIVED",
    images: [],
  }),
  newerForSameBhsUid: createCanonicalHbssScan({
    externalScanId: "SCAN-000007",
    capturedAt: "2026-08-02T10:05:00.000Z",
  }),
  olderForSameBhsUid: createCanonicalHbssScan({
    externalScanId: "SCAN-000008",
    capturedAt: "2026-08-02T09:55:00.000Z",
  }),
  duplicateExternalScanId,
  changedPayloadForSameExternalScanId: createCanonicalHbssScan({
    externalScanId: duplicateExternalScanId.externalScanId,
    status: "PENDING",
    images: [],
  }),
  wrongBhsUid: createCanonicalHbssScan({ bhsUid: HBSS_FIXTURE_BHS_UID_B }),
  missingBhsUid: (() => {
    const fixture = createCanonicalHbssScan();
    delete fixture.bhsUid;
    return fixture;
  })(),
  caseDifferentBhsUid: createCanonicalHbssScan({ bhsUid: "ABCDEFGHIJ" }),
  emptyImageList: createCanonicalHbssScan({ images: [] }),
  unsupportedMimeType: createCanonicalHbssScan({
    images: [createHbssImageView({ mimeType: "image/svg+xml" })],
  }),
  invalidStoragePath: createCanonicalHbssScan({
    images: [createHbssImageView({ url: "/mock-xray/../../etc/passwd" })],
  }),
  invalidUrl: createCanonicalHbssScan({
    images: [createHbssImageView({ url: "javascript:alert(1)" })],
  }),
  invalidCapturedTimestamp: createCanonicalHbssScan({ capturedAt: "not-a-timestamp" }),
  missingExternalScanId: (() => {
    const fixture = createCanonicalHbssScan();
    delete fixture.externalScanId;
    return fixture;
  })(),
  oversizedMetadata: createCanonicalHbssScan({ metadata: { value: "x".repeat(65 * 1024) } }),
  unexpectedFields: createCanonicalHbssScan({ undocumentedVendorField: "UNAPPROVED" }),
  prototypePollutionFields: JSON.parse(
    JSON.stringify(createCanonicalHbssScan()).replace(
      '"metadata":{"fixture":"P2-HBSS","containsPassengerData":false}',
      '"metadata":{"fixture":"P2-HBSS","__proto__":{"polluted":true}}',
    ),
  ),
  corruptedImageMetadata: createCanonicalHbssScan({
    images: [{ ...createHbssImageView(), label: { unexpected: "object" } }],
  }),
  differentBagScans: [
    createCanonicalHbssScan({
      externalScanId: "SCAN-BAG-A",
      bhsUid: HBSS_FIXTURE_BHS_UID_A,
      images: [createHbssImageView({ id: "IMAGE-A", url: "/mock-xray/bag-a.jpg" })],
    }),
    createCanonicalHbssScan({
      externalScanId: "SCAN-BAG-B",
      bhsUid: HBSS_FIXTURE_BHS_UID_B,
      images: [createHbssImageView({ id: "IMAGE-B", url: "/mock-xray/bag-b.jpg" })],
    }),
  ],
});
