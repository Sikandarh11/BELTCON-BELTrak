import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: {
    alias: {
      "@": path.join(repositoryRoot, "src"),
    },
  },
});

test.after(async () => {
  await vite.close();
});

const [
  { mockHbssAdapter },
  repositoryModule,
  serviceModule,
  apiModule,
  errorModule,
  statusModelModule,
  viewerModule,
  bagMappingsModule,
  screeningModule,
  hbssSchemasModule,
  auditRepositoryModule,
  emptyStateModule,
  selectionModule,
  viewerNavigationModule,
] = await Promise.all([
  vite.ssrLoadModule("/src/services/integrations/hbss/mockHbssAdapter.server.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayRepository.server.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayService.server.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayApi.server.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayErrors.ts"),
  vite.ssrLoadModule("/src/components/xray/xrayStatusModel.ts"),
  vite.ssrLoadModule("/src/components/xray/XrayViewer.tsx"),
  vite.ssrLoadModule("/src/services/bagPersistenceMappings.ts"),
  vite.ssrLoadModule("/src/types/screening.ts"),
  vite.ssrLoadModule("/src/services/integrations/hbss/hbssSchemas.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayViewAuditRepository.server.ts"),
  vite.ssrLoadModule("/src/components/xray/XrayEmptyState.tsx"),
  vite.ssrLoadModule("/src/services/xray/xrayScanSelection.ts"),
  vite.ssrLoadModule("/src/components/xray/xrayViewerNavigation.ts"),
]);

const { mapXrayScanRow } = repositoryModule;
const { createXrayService } = serviceModule;
const { resolveHbssRequestTimeoutMs } = serviceModule;
const {
  handleGetBagXrayRequest,
  handleRefreshBagXrayRequest,
  handleHbssHealthRequest,
  handleHbssIngestionRequest,
} = apiModule;
const { XrayNotFoundError, XrayPersistenceError, XrayValidationError } = errorModule;
const { getXrayDisplayStatus } = statusModelModule;
const { XrayViewer } = viewerModule;
const { bagToRow, rowToBag } = bagMappingsModule;
const { screeningEventV1Schema } = screeningModule;
const { hbssScanResultSchema } = hbssSchemasModule;
const { createXrayViewAuditRepository } = auditRepositoryModule;
const { XrayEmptyState } = emptyStateModule;
const { isUsableXrayScan, scanForDisplay, selectXrayScans, shouldStoreAsSeparateAttempt } =
  selectionModule;
const {
  getNextWorkingXrayImageIndex,
  getNextXrayImageIndex,
  getPreviousXrayImageIndex,
  getXrayImageKey,
  getXrayImageSignature,
  normalizeXrayImages,
} = viewerNavigationModule;

const availablePayload = {
  bhsUid: "0000000123",
  externalScanId: "SCAN-88721",
  sourceSystem: "MOCK_HBSS",
  status: "AVAILABLE",
  images: [
    {
      id: "side",
      label: "Side View",
      url: "/mock-xray/user/set-01/side.jpg",
      mimeType: "image/jpeg",
    },
  ],
  threatLevel: 4,
  threatType: "ORGANIC_DENSITY",
  capturedAt: "2026-07-24T10:30:00Z",
  metadata: {},
};

const screeningEvent = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000010",
  eventType: "BAG_SUSPECTED",
  sourceSystem: "SIMULATED_HBSS",
  occurredAt: "2026-07-24T10:30:00Z",
  bag: {
    bhsUid: "0000000123",
    iataCode: "0123456789",
    iataOrigin: "RUH",
    flightNo: "SV123",
    passengerName: "Optional",
  },
  screening: {
    station: "HBSS-SIM-01",
    screenedAt: "2026-07-24T10:29:00Z",
  },
  threat: {
    type: "ORGANIC_DENSITY",
    level: 4,
  },
  scan: {
    externalScanId: "SCAN-001",
    status: "AVAILABLE",
    images: [
      {
        imageId: "SIDE-01",
        view: "SIDE",
        label: "Side view",
        imageRef: "/mock-xray/user/set-01/side.jpg",
        mimeType: "image/jpeg",
      },
    ],
  },
};

function sampleScan(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    bagId: "ETB-000123",
    bhsUid: availablePayload.bhsUid,
    externalScanId: availablePayload.externalScanId,
    sourceSystem: availablePayload.sourceSystem,
    status: "AVAILABLE",
    images: availablePayload.images,
    threatLevel: 4,
    threatType: "ORGANIC_DENSITY",
    capturedAt: "2026-07-24T10:30:00.000Z",
    receivedAt: "2026-07-24T10:31:00.000Z",
    errorCode: null,
    errorMessage: null,
    metadata: {},
    createdAt: "2026-07-24T10:31:00.000Z",
    updatedAt: "2026-07-24T10:31:00.000Z",
    ...overrides,
  };
}

function sampleSelection(displayScan, latestAttempt = displayScan) {
  return { displayScan, latestAttempt };
}

function ingestionRequest(payload, key = "test-integration-key") {
  return new Request("http://localhost/api/integrations/hbss/scans", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hbss-integration-key": key,
    },
    body: JSON.stringify(payload),
  });
}

const configuredHbssIngestion = {
  integrationKey: "test-integration-key",
  sourceSystem: "MOCK_HBSS",
  siteId: "RUH",
  enabled: true,
};

function sessionForRole(role = "Operations Officer") {
  return {
    token: "session-token",
    expiresAt: "2026-07-24T11:30:00.000Z",
    user: {
      id: "user-xray-001",
      firstName: "Xray",
      lastName: "Officer",
      email: "xray@example.test",
      role,
      createdAt: "2026-07-24T09:00:00.000Z",
      lastLogin: null,
    },
  };
}

function bagXrayRequest(viewSessionId = "recheck-session-001") {
  return new Request("http://localhost/api/xray/bags/ETB-000123", {
    headers: {
      "x-xray-view-session-id": viewSessionId,
    },
  });
}

test("mock adapter returns an available response with image views", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("NORMAL0001");
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.images.length, 3);
  assert.deepEqual(
    result.images.map((image) => image.url),
    [
      "/mock-xray/user/set-01/side.jpg",
      "/mock-xray/user/set-01/top.jpg",
      "/mock-xray/user/set-01/density.jpg",
    ],
  );
  assert.ok(result.images.every((image) => image.mimeType === "image/jpeg"));
});

test("mock adapter returns PENDING", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("PENDING001");
  assert.equal(result.status, "PENDING");
  assert.deepEqual(result.images, []);
});

test("mock adapter returns NOT_FOUND", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("MISSING001");
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.images, []);
});

test("mock adapter returns FAILED", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("FAIL000001");
  assert.equal(result.status, "FAILED");
  assert.deepEqual(result.images, []);
});

test("mock adapter is deterministic for the same BHS UID", async () => {
  const first = await mockHbssAdapter.getScanByBhsUid("NORMAL0001");
  const second = await mockHbssAdapter.getScanByBhsUid("NORMAL0001");
  assert.deepEqual(second, first);
});

test("bag row mapping round-trips screening and identity fields", () => {
  const bag = {
    id: "ETB-000123",
    sourceSystem: "SIMULATED_HBSS",
    bhsUid: "0000000123",
    iataCode: "0123456789",
    iataOrigin: "RUH",
    epc: "E28068940000501A2B3C4D5E",
    flightNo: "SV123",
    passengerName: "Optional",
    threatType: "ORGANIC_DENSITY",
    threatLevel: 4,
    screeningStation: "HBSS-SIM-01",
    screenedAt: "2026-07-24T10:29:00Z",
    status: "TAGGED",
    flaggedAt: "2026-07-24T10:30:00Z",
    taggedAt: "2026-07-24T10:31:00Z",
    lastSeenZone: "TAGGING_STATION",
    notes: "Manual review requested",
    updatedAt: "2026-07-24T10:32:00Z",
  };

  assert.deepEqual(rowToBag(bagToRow(bag)), bag);
});

test("bag row mapping never falls back to the bag ID", () => {
  const row = bagToRow({
    id: "ETB-000124",
    flightNo: "SV124",
    status: "IDENTIFIED",
    flaggedAt: "2026-07-24T10:30:00Z",
  });

  assert.equal(row.bhs_uid, null);
  assert.equal(row.iata_code, null);
});

test("bag row mapping writes the baggage licence plate to iata_code", () => {
  const row = bagToRow({
    id: "ETB-000125",
    bhsUid: "0000000125",
    iataCode: "9876543210",
    flightNo: "SV125",
    status: "IDENTIFIED",
    flaggedAt: "2026-07-24T10:30:00Z",
  });

  assert.equal(row.iata_code, "9876543210");
  assert.notEqual(row.iata_code, row.id);
});

test("screening event accepts a valid AVAILABLE scan", () => {
  assert.equal(screeningEventV1Schema.safeParse(screeningEvent).success, true);
});

test("screening event requires a BHS UID", () => {
  const payload = structuredClone(screeningEvent);
  delete payload.bag.bhsUid;
  assert.equal(screeningEventV1Schema.safeParse(payload).success, false);
});

test("screening event rejects AVAILABLE without an image", () => {
  const payload = structuredClone(screeningEvent);
  payload.scan.images = [];
  assert.equal(screeningEventV1Schema.safeParse(payload).success, false);
});

test("screening event accepts PENDING without an image", () => {
  const payload = structuredClone(screeningEvent);
  payload.scan.status = "PENDING";
  payload.scan.images = [];
  assert.equal(screeningEventV1Schema.safeParse(payload).success, true);
});

test("screening event rejects an invalid threat level", () => {
  const payload = structuredClone(screeningEvent);
  payload.threat.level = 6;
  assert.equal(screeningEventV1Schema.safeParse(payload).success, false);
});

test("screening event rejects a remote image URL", () => {
  const payload = structuredClone(screeningEvent);
  payload.scan.images[0].imageRef = "https://example.com/scan.jpg";
  assert.equal(screeningEventV1Schema.safeParse(payload).success, false);
});

test("screening event rejects a Base64 data URL", () => {
  const payload = structuredClone(screeningEvent);
  payload.scan.images[0].imageRef = "data:image/jpeg;base64,AA==";
  assert.equal(screeningEventV1Schema.safeParse(payload).success, false);
});

test("screening event rejects an unsupported image MIME type", () => {
  const payload = structuredClone(screeningEvent);
  payload.scan.images[0].mimeType = "image/gif";
  assert.equal(screeningEventV1Schema.safeParse(payload).success, false);
});

test("HBSS validation rejects AVAILABLE without an image", () => {
  assert.equal(
    hbssScanResultSchema.safeParse({
      ...availablePayload,
      images: [],
    }).success,
    false,
  );
});

test("X-ray display statuses cover every operational scan state", () => {
  assert.equal(getXrayDisplayStatus(sampleScan()), "Available");
  assert.equal(getXrayDisplayStatus(sampleScan({ status: "PENDING" })), "Pending");
  assert.equal(getXrayDisplayStatus(sampleScan({ status: "NOT_FOUND" })), "Missing");
  assert.equal(getXrayDisplayStatus(sampleScan({ status: "FAILED" })), "Failed");
  assert.equal(getXrayDisplayStatus(sampleScan({ status: "ARCHIVED" })), "Archived");
  assert.equal(getXrayDisplayStatus(null), "Not requested");
});

test("X-ray viewer renders real image views with accessible controls", () => {
  const scan = sampleScan({
    images: [
      availablePayload.images[0],
      {
        id: "top",
        label: "Top View",
        url: "/mock-xray/user/set-01/top.jpg",
        mimeType: "image/jpeg",
      },
      {
        id: "density",
        label: "Density View",
        url: "/mock-xray/user/set-01/density.jpg",
        mimeType: "image/jpeg",
      },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(XrayViewer, {
      bagId: "ETB-000123",
      scan,
    }),
  );

  assert.match(html, /src="\/mock-xray\/user\/set-01\/side\.jpg"/);
  assert.match(html, /alt="Side View for bag ETB-000123"/);
  assert.match(html, /1 \/ 3/);
  assert.match(html, /aria-label="Previous X-ray view"/);
  assert.match(html, /aria-label="Next X-ray view"/);
  assert.match(html, /aria-label="Zoom in"/);
  assert.match(html, /aria-label="Rotate X-ray clockwise"/);
  assert.match(html, /aria-label="Reset X-ray view"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Show Top View"/);

  const buttonCount = html.match(/<button/g)?.length ?? 0;
  const typedButtonCount = html.match(/<button type="button"/g)?.length ?? 0;
  assert.equal(typedButtonCount, buttonCount);
});

test("X-ray viewer navigation advances, wraps, and updates the active image", () => {
  const images = normalizeXrayImages([
    availablePayload.images[0],
    {
      id: "top",
      label: "Top View",
      url: "/mock-xray/user/set-01/top.jpg",
      mimeType: "image/jpeg",
    },
    {
      id: "density",
      label: "Density View",
      url: "/mock-xray/user/set-01/density.jpg",
      mimeType: "image/jpeg",
    },
  ]);

  let activeIndex = 0;
  assert.equal(`${activeIndex + 1} / ${images.length}`, "1 / 3");
  assert.equal(images[activeIndex].url, "/mock-xray/user/set-01/side.jpg");
  assert.equal(images[activeIndex].label, "Side View");

  activeIndex = getNextXrayImageIndex(activeIndex, images.length);
  assert.equal(`${activeIndex + 1} / ${images.length}`, "2 / 3");
  assert.equal(images[activeIndex].url, "/mock-xray/user/set-01/top.jpg");
  assert.equal(images[activeIndex].label, "Top View");

  activeIndex = getNextXrayImageIndex(activeIndex, images.length);
  assert.equal(`${activeIndex + 1} / ${images.length}`, "3 / 3");
  assert.equal(images[activeIndex].url, "/mock-xray/user/set-01/density.jpg");
  assert.equal(images[activeIndex].label, "Density View");

  activeIndex = getNextXrayImageIndex(activeIndex, images.length);
  assert.equal(`${activeIndex + 1} / ${images.length}`, "1 / 3");

  activeIndex = getPreviousXrayImageIndex(activeIndex, images.length);
  assert.equal(`${activeIndex + 1} / ${images.length}`, "3 / 3");
});

test("X-ray thumbnail selection uses the selected image index", () => {
  const images = normalizeXrayImages([
    availablePayload.images[0],
    {
      id: "top",
      label: "Top View",
      url: "/mock-xray/user/set-01/top.jpg",
      mimeType: "image/jpeg",
    },
    {
      id: "density",
      label: "Density View",
      url: "/mock-xray/user/set-01/density.jpg",
      mimeType: "image/jpeg",
    },
  ]);

  const thumbnailIndex = 2;
  assert.equal(images[thumbnailIndex].label, "Density View");
  assert.equal(images[thumbnailIndex].url, "/mock-xray/user/set-01/density.jpg");
});

test("X-ray scan identity stays stable across equivalent image-array allocations", async () => {
  const images = [
    availablePayload.images[0],
    {
      id: "top",
      label: "Top View",
      url: "/mock-xray/user/set-01/top.jpg",
      mimeType: "image/jpeg",
    },
    {
      id: "density",
      label: "Density View",
      url: "/mock-xray/user/set-01/density.jpg",
      mimeType: "image/jpeg",
    },
  ];
  const firstSignature = getXrayImageSignature(normalizeXrayImages(images));
  const secondSignature = getXrayImageSignature(
    normalizeXrayImages(images.map((image) => ({ ...image }))),
  );

  assert.equal(secondSignature, firstSignature);

  const viewerSource = await readFile(
    path.join(repositoryRoot, "src/components/xray/XrayViewer.tsx"),
    "utf8",
  );
  assert.match(viewerSource, /\[bagId, scan\.id, imageSignature\]/);
  assert.doesNotMatch(viewerSource, /\[bagId, scan\.id, scan\.updatedAt\]/);
});

test("X-ray transform changes and failure tracking do not reset the selected index", async () => {
  const viewerSource = await readFile(
    path.join(repositoryRoot, "src/components/xray/XrayViewer.tsx"),
    "utf8",
  );
  const transformEffect = viewerSource.match(
    /useEffect\(\(\) => \{\s+setZoom\(1\);\s+setRotation\(0\);\s+\}, \[activeImage\?\.id, activeImage\?\.url\]\);/,
  );

  assert.ok(transformEffect);
  assert.doesNotMatch(transformEffect[0], /setActiveIndex/);
  assert.match(viewerSource, /setZoom\(\(value\) => Math\.min/);
  assert.match(viewerSource, /setRotation\(\(value\) => value \+ ROTATION_STEP\)/);
});

test("X-ray failed-image navigation skips the broken view without resetting to zero", () => {
  const images = normalizeXrayImages([
    availablePayload.images[0],
    {
      id: "top",
      label: "Top View",
      url: "/mock-xray/user/set-01/top.jpg",
      mimeType: "image/jpeg",
    },
    {
      id: "density",
      label: "Density View",
      url: "/mock-xray/user/set-01/density.jpg",
      mimeType: "image/jpeg",
    },
  ]);
  const failedImageIds = new Set([getXrayImageKey(images[1])]);

  assert.equal(getNextWorkingXrayImageIndex(images, 1, failedImageIds), 2);
  failedImageIds.add(getXrayImageKey(images[2]));
  assert.equal(getNextWorkingXrayImageIndex(images, 1, failedImageIds), 0);
  failedImageIds.add(getXrayImageKey(images[0]));
  assert.equal(getNextWorkingXrayImageIndex(images, 1, failedImageIds), 1);
});

test("X-ray viewer keyboard navigation is scoped to the focused viewer", async () => {
  const viewerSource = await readFile(
    path.join(repositoryRoot, "src/components/xray/XrayViewer.tsx"),
    "utf8",
  );

  assert.match(viewerSource, /if \(event\.target !== event\.currentTarget\) return;/);
  assert.match(viewerSource, /event\.key === "ArrowRight"/);
  assert.match(viewerSource, /event\.key === "ArrowLeft"/);
});

test("X-ray unavailable state explicitly preserves manual resolution", () => {
  const html = renderToStaticMarkup(
    createElement(XrayEmptyState, {
      kind: "failed",
      showManualInspectionWarning: true,
    }),
  );

  assert.match(html, /X-ray imagery is not required to continue/);
  assert.match(html, /record officer notes/);
  assert.match(html, /existing resolution actions below/);
});

test("X-ray support does not restore browser-owned bag lifecycle state", async () => {
  const [storeSource, persistenceSource, bagServiceSource] = await Promise.all(
    [
      "src/store/appStore.ts",
      "src/services/persistenceService.ts",
      "src/services/bagService.ts",
    ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );

  assert.doesNotMatch(storeSource, /bags:|alarms:|events:|resolutions:/);
  assert.doesNotMatch(persistenceSource, /supabase\.from\(/);
  assert.match(bagServiceSource, /Browser bag lifecycle authority was removed/);
});

test("repository maps snake_case rows to the X-ray domain model", () => {
  const mapped = mapXrayScanRow({
    id: "00000000-0000-4000-8000-000000000001",
    bag_id: "ETB-000123",
    bhs_uid: "0000000123",
    external_scan_id: "SCAN-88721",
    source_system: "MOCK_HBSS",
    status: "AVAILABLE",
    images: availablePayload.images,
    threat_level: 4,
    threat_type: "ORGANIC_DENSITY",
    captured_at: "2026-07-24T10:30:00.000Z",
    received_at: "2026-07-24T10:31:00.000Z",
    error_code: null,
    error_message: null,
    metadata: { lane: "A1" },
    created_at: "2026-07-24T10:31:00.000Z",
    updated_at: "2026-07-24T10:31:00.000Z",
  });

  assert.deepEqual(mapped, sampleScan({ metadata: { lane: "A1" } }));
});

test("existing AVAILABLE simulated scan is selected for automatic display", () => {
  const simulatedScan = sampleScan({
    sourceSystem: "SIMULATED_HBSS",
    externalScanId: "SIM-SCAN-001",
  });
  const selection = selectXrayScans([simulatedScan]);

  assert.equal(selection.displayScan, simulatedScan);
  assert.equal(selection.latestAttempt, simulatedScan);
  assert.equal(scanForDisplay(selection), simulatedScan);
  assert.equal(isUsableXrayScan(selection.displayScan), true);
});

test("latest FAILED attempt does not mask an older AVAILABLE scan", () => {
  const available = sampleScan({
    id: "00000000-0000-4000-8000-000000000010",
    sourceSystem: "SIMULATED_HBSS",
    externalScanId: "SIM-SCAN-010",
    receivedAt: "2026-07-24T10:31:00.000Z",
    createdAt: "2026-07-24T10:31:00.000Z",
  });
  const originalImages = structuredClone(available.images);
  const failed = sampleScan({
    id: "00000000-0000-4000-8000-000000000011",
    sourceSystem: "HBSS",
    externalScanId: null,
    status: "FAILED",
    images: [],
    receivedAt: "2026-07-24T10:35:00.000Z",
    createdAt: "2026-07-24T10:35:00.000Z",
    errorCode: "HBSS_RETRIEVAL_FAILED",
    errorMessage: "HBSS scan retrieval failed",
  });
  const selection = selectXrayScans([failed, available]);

  assert.equal(selection.latestAttempt, failed);
  assert.equal(selection.displayScan, available);
  assert.equal(scanForDisplay(selection), available);
  assert.deepEqual(available.images, originalImages);
  assert.equal(
    shouldStoreAsSeparateAttempt(available, {
      externalScanId: available.externalScanId,
      bhsUid: available.bhsUid,
      sourceSystem: available.sourceSystem,
      status: "FAILED",
      images: [],
    }),
    true,
  );
});

test("newer usable AVAILABLE scan replaces the older available scan", () => {
  const older = sampleScan({
    id: "00000000-0000-4000-8000-000000000020",
    externalScanId: "SIM-SCAN-020",
    receivedAt: "2026-07-24T10:31:00.000Z",
    createdAt: "2026-07-24T10:31:00.000Z",
  });
  const newer = sampleScan({
    id: "00000000-0000-4000-8000-000000000021",
    externalScanId: "SIM-SCAN-021",
    receivedAt: "2026-07-24T10:36:00.000Z",
    createdAt: "2026-07-24T10:36:00.000Z",
  });
  const selection = selectXrayScans([older, newer]);

  assert.equal(selection.displayScan, newer);
  assert.equal(selection.latestAttempt, newer);
});

test("PENDING is displayed only when no usable scan exists", () => {
  const pending = sampleScan({ status: "PENDING", images: [] });
  const selection = selectXrayScans([pending]);

  assert.equal(selection.displayScan, null);
  assert.equal(selection.latestAttempt, pending);
  assert.equal(scanForDisplay(selection), pending);
});

test("NOT_FOUND is displayed only when no usable scan exists", () => {
  const notFound = sampleScan({ status: "NOT_FOUND", images: [] });
  const selection = selectXrayScans([notFound]);

  assert.equal(selection.displayScan, null);
  assert.equal(selection.latestAttempt, notFound);
  assert.equal(scanForDisplay(selection), notFound);
});

test("scan selection preserves simulator identity, timestamps, and image references", () => {
  const simulatedScan = sampleScan({
    sourceSystem: "SIMULATED_HBSS",
    externalScanId: "USER-SCAN-IDENTITY-01",
    capturedAt: "2026-07-24T10:29:00.000Z",
    images: [
      {
        id: "SIDE-01",
        label: "Side view",
        url: "/mock-xray/user/set-01/side.jpg",
        mimeType: "image/jpeg",
      },
    ],
  });
  const displayed = scanForDisplay(selectXrayScans([simulatedScan]));

  assert.equal(displayed.externalScanId, "USER-SCAN-IDENTITY-01");
  assert.equal(displayed.sourceSystem, "SIMULATED_HBSS");
  assert.equal(displayed.capturedAt, "2026-07-24T10:29:00.000Z");
  assert.deepEqual(displayed.images, simulatedScan.images);
});

test("Recheck retains the viewer during refresh and prevents duplicate submissions", async () => {
  const recheckSource = await readFile(
    path.join(repositoryRoot, "src", "routes", "recheck.tsx"),
    "utf8",
  );

  assert.match(recheckSource, /const xrayScan = scanForDisplay\(xraySelection\)/);
  assert.match(recheckSource, /Latest HBSS refresh failed\./);
  assert.match(recheckSource, /HBSS X-ray refresh timed out\. No new image was accepted\./);
  assert.match(recheckSource, /Displaying the last available scan\./);
  assert.match(recheckSource, /Refresh from HBSS/);
  assert.match(recheckSource, /xrayRefreshInFlightRef\.current/);
  assert.match(recheckSource, /xrayRefreshInFlightRef\.current = true/);
  assert.match(recheckSource, /xrayRefreshInFlightRef\.current = false/);
  assert.match(recheckSource, /disabled={xrayRefreshing}/);
  assert.doesNotMatch(
    recheckSource,
    /setXraySelection\(\{ displayScan: null, latestAttempt: null \}\);[\s\S]{0,500}setXrayRefreshing\(true\)/,
  );
});

test("refresh loads a bag BHS UID, calls the adapter, and persists the result", async () => {
  let persistedBagId;
  let persistedResult;
  const auditEvents = [];
  const storedScan = sampleScan();

  const service = createXrayService({
    bagRepository: {
      async findById() {
        return { id: "ETB-000123", bhsUid: "0000000123" };
      },
      async findByBhsUid() {
        return null;
      },
    },
    repository: {
      async findLatestByBagId() {
        return null;
      },
      async findLatestByBhsUid() {
        return null;
      },
      async upsertFromAdapterResult(bagId, expectedBhsUid, result) {
        persistedBagId = bagId;
        assert.equal(expectedBhsUid, "0000000123");
        persistedResult = result;
        return { scan: storedScan, disposition: "CREATED" };
      },
      async saveFailure() {
        throw new Error("saveFailure should not be called");
      },
    },
    adapterFactory: () => mockHbssAdapter,
    audit: (event) => auditEvents.push(event),
  });

  const scan = await service.refreshScanForBag("ETB-000123");
  assert.equal(scan, storedScan);
  assert.equal(persistedBagId, "ETB-000123");
  assert.equal(persistedResult.bhsUid, "0000000123");
  assert.deepEqual(
    auditEvents.map((event) => event.action),
    ["XRAY_REFRESH_REQUESTED", "XRAY_SCAN_RECEIVED"],
  );
});

function correlationService(returnedResult, observations = {}) {
  const auditEvents = observations.auditEvents ?? [];
  const writes = observations.writes ?? [];
  return createXrayService({
    bagRepository: {
      async findById() {
        return { id: "ETB-CORRELATION", bhsUid: "1234567890" };
      },
      async findByBhsUid() {
        return null;
      },
    },
    repository: {
      async findSelectionByBagId() {
        return sampleSelection(null);
      },
      async upsertFromAdapterResult(_bagId, _expectedBhsUid, result) {
        writes.push(result);
        return {
          scan: sampleScan({ bhsUid: result.bhsUid, images: result.images }),
          disposition: "CREATED",
        };
      },
      async saveFailure() {
        observations.failureWrites = (observations.failureWrites ?? 0) + 1;
        return sampleScan({ status: "FAILED", images: [] });
      },
    },
    adapterFactory: () => ({
      name: "TEST_HBSS",
      async getScanByBhsUid(_bhsUid, options) {
        observations.signal = options?.signal;
        return typeof returnedResult === "function"
          ? returnedResult(options?.signal)
          : returnedResult;
      },
      async healthCheck() {
        return { healthy: true };
      },
    }),
    audit: (event) => auditEvents.push(event),
    requestTimeoutMs: observations.requestTimeoutMs ?? (() => 1_000),
  });
}

function correlatedResult(bhsUid = "1234567890") {
  return {
    ...availablePayload,
    bhsUid,
    externalScanId: `CORRELATION-${bhsUid || "EMPTY"}`,
  };
}

test("HBSS refresh persists only an exact, case-sensitive BHS BagID match", async () => {
  const observations = { writes: [], auditEvents: [] };
  const service = correlationService(correlatedResult(), observations);

  const scan = await service.refreshScanForBag("ETB-CORRELATION");

  assert.equal(scan.bhsUid, "1234567890");
  assert.equal(observations.writes.length, 1);
  assert.deepEqual(
    observations.auditEvents.map((event) => event.action),
    ["XRAY_REFRESH_REQUESTED", "XRAY_SCAN_RECEIVED"],
  );
});

for (const [label, returned] of [
  ["different", "0987654321"],
  ["same prefix", "1234567891"],
  ["same suffix", "9234567890"],
  ["different case", "ABCDEFGHIJ"],
  ["empty", ""],
  ["missing", undefined],
]) {
  test(`HBSS refresh rejects a ${label} returned BHS BagID without mutation`, async () => {
    const observations = { writes: [], auditEvents: [] };
    const result = correlatedResult(returned ?? "1234567890");
    if (returned === undefined) delete result.bhsUid;
    const service =
      label === "different case"
        ? createXrayService({
            bagRepository: {
              async findById() {
                return { id: "ETB-CORRELATION", bhsUid: "abcdefghij" };
              },
              async findByBhsUid() {
                return null;
              },
            },
            repository: {
              async upsertFromAdapterResult() {
                observations.writes.push(result);
                return { scan: sampleScan(), disposition: "CREATED" };
              },
              async saveFailure() {
                observations.failureWrites = (observations.failureWrites ?? 0) + 1;
                return sampleScan({ status: "FAILED", images: [] });
              },
            },
            adapterFactory: () => ({
              name: "TEST_HBSS",
              async getScanByBhsUid() {
                return result;
              },
              async healthCheck() {
                return { healthy: true };
              },
            }),
            audit: (event) => observations.auditEvents.push(event),
            requestTimeoutMs: () => 1_000,
          })
        : correlationService(result, observations);

    await assert.rejects(
      () => service.refreshScanForBag("ETB-CORRELATION"),
      (error) => error.code === "HBSS_BHS_UID_MISMATCH" && error.status === 502,
    );
    assert.equal(observations.writes.length, 0);
    assert.equal(observations.failureWrites ?? 0, 0);
    assert.equal(observations.auditEvents.at(-1).errorCode, "HBSS_BHS_UID_MISMATCH");
  });
}

test("correlation failure API body contains no returned image", async () => {
  const wrong = correlatedResult("0987654321");
  const service = correlationService(wrong);
  const response = await handleRefreshBagXrayRequest(bagXrayRequest(), "ETB-CORRELATION", {
    async getSession() {
      return sessionForRole();
    },
    service,
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.code, "HBSS_BHS_UID_MISMATCH");
  assert.doesNotMatch(JSON.stringify(body), /side\.jpg|0987654321/);
});

test("Recheck never renders an adapter refresh result directly", async () => {
  const source = await readFile(path.join(repositoryRoot, "src/routes/recheck.tsx"), "utf8");
  assert.match(source, /const xrayScan = scanForDisplay\(xraySelection\)/);
  assert.match(source, /scan={xraySelection\.displayScan}/);
  assert.doesNotMatch(source, /scan={refreshXray\.(?:data|result)}/);
});

test("HBSS timeout configuration uses a safe default and rejects invalid bounds", () => {
  assert.equal(resolveHbssRequestTimeoutMs(undefined), 10_000);
  assert.equal(resolveHbssRequestTimeoutMs(""), 10_000);
  assert.equal(resolveHbssRequestTimeoutMs("100"), 100);
  assert.equal(resolveHbssRequestTimeoutMs("120000"), 120_000);
  for (const value of ["abc", "99", "120001", "-1", "1.5"]) {
    assert.throws(() => resolveHbssRequestTimeoutMs(value), /HBSS request timeout/);
  }
});

test("adapter completion before the timeout succeeds", async () => {
  const observations = { writes: [] };
  const service = correlationService(Promise.resolve(correlatedResult()), observations);
  await service.refreshScanForBag("ETB-CORRELATION");
  assert.equal(observations.writes.length, 1);
});

test("adapter at the exact timeout boundary times out and cancellation propagates", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const observations = { writes: [], auditEvents: [], requestTimeoutMs: () => 100 };
  const service = correlationService(
    (signal) =>
      new Promise((resolve) => {
        observations.adapterSignal = signal;
        setTimeout(() => resolve(correlatedResult()), 100);
      }),
    observations,
  );
  const assertion = assert.rejects(
    service.refreshScanForBag("ETB-CORRELATION"),
    (error) => error.code === "HBSS_REQUEST_TIMED_OUT",
  );
  while (!observations.signal) await Promise.resolve();
  t.mock.timers.tick(100);
  await assertion;
  assert.equal(observations.adapterSignal.aborted, true);
  assert.equal(observations.writes.length, 0);
});

test("late result from an adapter that ignores cancellation never writes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish;
  const observations = { writes: [], auditEvents: [], requestTimeoutMs: () => 100 };
  const service = correlationService(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    observations,
  );
  const assertion = assert.rejects(
    service.refreshScanForBag("ETB-CORRELATION"),
    (error) => error.code === "HBSS_REQUEST_TIMED_OUT",
  );
  while (!finish) await Promise.resolve();
  t.mock.timers.tick(101);
  await assertion;
  finish(correlatedResult());
  await Promise.resolve();
  assert.equal(observations.writes.length, 0);
  assert.equal(observations.failureWrites ?? 0, 0);
  assert.equal(observations.auditEvents.at(-1).errorCode, "HBSS_REQUEST_TIMED_OUT");
});

test("retry after timeout succeeds without accepting the late first result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  let finishFirst;
  const observations = { writes: [], auditEvents: [], requestTimeoutMs: () => 100 };
  const service = correlationService(() => {
    attempts += 1;
    if (attempts === 1) return new Promise((resolve) => (finishFirst = resolve));
    return Promise.resolve(correlatedResult());
  }, observations);
  const firstAssertion = assert.rejects(
    service.refreshScanForBag("ETB-CORRELATION"),
    (error) => error.code === "HBSS_REQUEST_TIMED_OUT",
  );
  while (!finishFirst) await Promise.resolve();
  t.mock.timers.tick(100);
  await firstAssertion;
  await service.refreshScanForBag("ETB-CORRELATION");
  finishFirst(correlatedResult());
  await Promise.resolve();
  assert.equal(observations.writes.length, 1);
});

test("refresh rejects a bag with no BHS UID before calling the adapter", async () => {
  let adapterCalled = false;
  const service = createXrayService({
    bagRepository: {
      async findById() {
        return { id: "ETB-NO-BHS", bhsUid: null };
      },
      async findByBhsUid() {
        return null;
      },
    },
    adapterFactory: () => {
      adapterCalled = true;
      return mockHbssAdapter;
    },
    audit: () => undefined,
  });

  await assert.rejects(
    () => service.refreshScanForBag("ETB-NO-BHS"),
    (error) => error.code === "BHS_UID_REQUIRED" && error.message === "Bag has no valid BHS UID",
  );
  assert.equal(adapterCalled, false);
});

test("stored X-ray reads reject an unauthenticated request", async () => {
  let serviceCalled = false;
  const response = await handleGetBagXrayRequest(bagXrayRequest(), "ETB-000123", {
    async getSession() {
      return null;
    },
    service: {
      async getScanSelectionForBag() {
        serviceCalled = true;
        return sampleSelection(sampleScan());
      },
    },
  });

  assert.equal(response.status, 401);
  assert.equal(serviceCalled, false);
});

test("stored X-ray API returns both the display scan and latest attempt", async () => {
  const available = sampleScan({
    sourceSystem: "SIMULATED_HBSS",
    externalScanId: "SIM-API-001",
  });
  const failed = sampleScan({
    id: "00000000-0000-4000-8000-000000000099",
    sourceSystem: "HBSS",
    externalScanId: null,
    status: "FAILED",
    images: [],
    receivedAt: "2026-07-24T10:40:00.000Z",
    createdAt: "2026-07-24T10:40:00.000Z",
  });
  const response = await handleGetBagXrayRequest(bagXrayRequest(), "ETB-000123", {
    async getSession() {
      return sessionForRole();
    },
    service: {
      async getScanSelectionForBag() {
        return sampleSelection(available, failed);
      },
    },
    viewAudit: {
      async recordViewed() {
        return "CREATED";
      },
    },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.displayScan.externalScanId, "SIM-API-001");
  assert.equal(body.displayScan.sourceSystem, "SIMULATED_HBSS");
  assert.equal(body.latestAttempt.status, "FAILED");
});

test("refresh requires an authenticated canonical Operations Officer", async () => {
  let refreshCalled = false;
  const unauthorized = await handleRefreshBagXrayRequest(bagXrayRequest(), "ETB-000123", {
    async getSession() {
      return null;
    },
    service: {
      async refreshScanForBag() {
        refreshCalled = true;
        return sampleScan({ status: "PENDING", images: [] });
      },
      async getScanSelectionForBag() {
        const pending = sampleScan({ status: "PENDING", images: [] });
        return sampleSelection(null, pending);
      },
    },
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(refreshCalled, false);

  const authorized = await handleRefreshBagXrayRequest(bagXrayRequest(), "ETB-000123", {
    async getSession() {
      return sessionForRole();
    },
    service: {
      async refreshScanForBag() {
        refreshCalled = true;
        return sampleScan({ status: "PENDING", images: [] });
      },
      async getScanSelectionForBag() {
        const pending = sampleScan({ status: "PENDING", images: [] });
        return sampleSelection(null, pending);
      },
    },
  });
  assert.equal(authorized.status, 200);
  assert.equal(refreshCalled, true);
});

test("XRAY_VIEWED is durable and idempotent for one Recheck view session", async () => {
  const durableRows = new Map();
  const repository = createXrayViewAuditRepository(async (row) => {
    const key = [row.action, row.actor_id, row.bag_id, row.xray_scan_id, row.request_id].join(":");
    if (durableRows.has(key)) {
      return { error: { code: "23505", message: "duplicate" } };
    }
    durableRows.set(key, row);
    return { error: null };
  });
  const options = {
    async getSession() {
      return sessionForRole("Operations Officer");
    },
    service: {
      async getScanSelectionForBag() {
        return sampleSelection(sampleScan());
      },
    },
    viewAudit: repository,
  };

  const first = await handleGetBagXrayRequest(
    bagXrayRequest("same-recheck-session"),
    "ETB-000123",
    options,
  );
  const second = await handleGetBagXrayRequest(
    bagXrayRequest("same-recheck-session"),
    "ETB-000123",
    options,
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(durableRows.size, 1);
  const [audit] = durableRows.values();
  assert.equal(audit.action, "XRAY_VIEWED");
  assert.equal(audit.actor_id, "user-xray-001");
  assert.equal(audit.canonical_role, "Operations Officer");
  assert.equal(audit.bag_id, "ETB-000123");
  assert.equal(audit.xray_scan_id, sampleScan().id);
  assert.equal(audit.request_id, "same-recheck-session");
  assert.equal(audit.outcome, "SUCCESS");
  assert.deepEqual(audit.metadata, {});
  assert.doesNotMatch(JSON.stringify(audit), /side\.jpg|image\/jpeg|images/);

  const newViewSession = await handleGetBagXrayRequest(
    bagXrayRequest("new-recheck-session"),
    "ETB-000123",
    options,
  );
  assert.equal(newViewSession.status, 200);
  assert.equal(durableRows.size, 2);
});

test("X-ray view audit migration enforces durable view-session idempotency", async () => {
  const migration = await readFile(
    path.join(repositoryRoot, "supabase", "migrations", "010_create_xray_view_audit_guard.sql"),
    "utf8",
  );

  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/i);
  assert.match(migration, /action,\s*actor_id,\s*bag_id,\s*xray_scan_id,\s*request_id/is);
  assert.match(migration, /WHERE action = 'XRAY_VIEWED'/i);
});

test("unavailable scans do not create XRAY_VIEWED", async () => {
  let audits = 0;
  const response = await handleGetBagXrayRequest(bagXrayRequest(), "ETB-000123", {
    async getSession() {
      return sessionForRole();
    },
    service: {
      async getScanSelectionForBag() {
        const pending = sampleScan({ status: "PENDING", images: [] });
        return sampleSelection(null, pending);
      },
    },
    viewAudit: {
      async recordViewed() {
        audits += 1;
        return "CREATED";
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(audits, 0);
});

test("available image references are not returned when durable audit fails", async () => {
  const response = await handleGetBagXrayRequest(bagXrayRequest(), "ETB-000123", {
    async getSession() {
      return sessionForRole();
    },
    service: {
      async getScanSelectionForBag() {
        return sampleSelection(sampleScan());
      },
    },
    viewAudit: {
      async recordViewed() {
        throw new XrayPersistenceError("Unable to record the X-ray view audit event");
      },
    },
  });

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "XRAY_PERSISTENCE_ERROR");
  assert.equal("scan" in body, false);
});

test("mock health reports a safe simulated status", async () => {
  const service = createXrayService({
    adapterFactory: () => mockHbssAdapter,
    audit: () => undefined,
  });
  const health = await service.getAdapterHealth();

  assert.equal(health.adapter, "Mock");
  assert.equal(health.healthy, true);
  assert.equal(health.status, "SIMULATED");
  assert.match(health.message, /static user-provided images/);
  assert.ok(!Number.isNaN(new Date(health.lastChecked).getTime()));
});

test("health API returns only safe fields and strips secret-shaped data", async () => {
  const response = await handleHbssHealthRequest({
    service: {
      async getAdapterHealth() {
        return {
          adapter: "Mock",
          healthy: true,
          status: "SIMULATED",
          lastChecked: "2026-07-24T10:30:00.000Z",
          message: "Safe simulated adapter",
          baseUrl: "https://secret.internal",
          clientSecret: "do-not-return",
          integrationKey: "do-not-return",
          serviceRoleKey: "do-not-return",
        };
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), [
    "adapter",
    "healthy",
    "lastChecked",
    "message",
    "status",
  ]);
  assert.doesNotMatch(JSON.stringify(body), /secret|internal|integrationKey|serviceRole/i);
});

test("ingestion rejects an invalid integration key", async () => {
  let serviceCalled = false;
  const response = await handleHbssIngestionRequest(
    ingestionRequest(availablePayload, "wrong-key"),
    {
      ...configuredHbssIngestion,
      service: {
        async ingestScan() {
          serviceCalled = true;
          return sampleScan();
        },
      },
    },
  );

  assert.equal(response.status, 401);
  assert.equal(serviceCalled, false);
});

test("ingestion accepts a valid request and returns the stored scan", async () => {
  let receivedPayload;
  const response = await handleHbssIngestionRequest(ingestionRequest(availablePayload), {
    ...configuredHbssIngestion,
    service: {
      async ingestScan(payload) {
        receivedPayload = payload;
        return sampleScan();
      },
    },
  });

  assert.equal(response.status, 201);
  assert.equal(receivedPayload.bhsUid, availablePayload.bhsUid);
  assert.deepEqual(await response.json(), { scan: sampleScan() });
});

test("HBSS credential binds source and site from trusted server configuration", async () => {
  const received = [];
  const response = await handleHbssIngestionRequest(
    ingestionRequest({ ...availablePayload, siteId: "RUH" }),
    {
      ...configuredHbssIngestion,
      service: {
        async ingestScan(payload) {
          received.push(payload);
          return sampleScan({ sourceSystem: payload.sourceSystem });
        },
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(received[0].sourceSystem, "MOCK_HBSS");
  assert.equal("siteId" in received[0], false);
});

test("trusted HBSS source is the source persisted and audited", async () => {
  const audits = [];
  let persisted;
  const service = createXrayService({
    bagRepository: {
      async findById() {
        return null;
      },
      async findByBhsUid() {
        return { id: "ETB-TRUSTED-SOURCE", bhsUid: availablePayload.bhsUid };
      },
    },
    repository: {
      async upsertFromAdapterResult(bagId, expectedBhsUid, result) {
        persisted = { bagId, expectedBhsUid, result };
        return {
          scan: sampleScan({ bagId, sourceSystem: result.sourceSystem }),
          disposition: "CREATED",
        };
      },
    },
    audit: (event) => audits.push(event),
  });

  await service.ingestScan(availablePayload);
  assert.equal(persisted.result.sourceSystem, "MOCK_HBSS");
  assert.equal(audits[0].sourceSystem, "MOCK_HBSS");
});

test("HBSS credential cannot claim another source or site", async () => {
  for (const payload of [
    { ...availablePayload, sourceSystem: "OTHER_HBSS" },
    { ...availablePayload, siteId: "SITE_B" },
  ]) {
    let serviceCalled = false;
    const response = await handleHbssIngestionRequest(ingestionRequest(payload), {
      ...configuredHbssIngestion,
      service: {
        async ingestScan() {
          serviceCalled = true;
          return sampleScan();
        },
      },
    });
    assert.equal(response.status, 400);
    assert.equal(serviceCalled, false);
    assert.equal((await response.json()).code, "HBSS_PAYLOAD_INVALID");
  }
});

test("disabled, incomplete, and wrong-endpoint HBSS bindings fail closed", async () => {
  const disabled = await handleHbssIngestionRequest(ingestionRequest(availablePayload), {
    ...configuredHbssIngestion,
    enabled: false,
  });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, "HBSS_INTEGRATION_DISABLED");

  const missingSite = await handleHbssIngestionRequest(ingestionRequest(availablePayload), {
    ...configuredHbssIngestion,
    siteId: null,
  });
  assert.equal(missingSite.status, 503);
  assert.equal((await missingSite.json()).code, "HBSS_INTEGRATION_NOT_CONFIGURED");

  const wrongEndpoint = await handleHbssIngestionRequest(
    new Request("http://localhost/api/integrations/hbss/other", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hbss-integration-key": "test-integration-key",
      },
      body: JSON.stringify(availablePayload),
    }),
    configuredHbssIngestion,
  );
  assert.equal(wrongEndpoint.status, 403);
  assert.equal((await wrongEndpoint.json()).code, "HBSS_INTEGRATION_ENDPOINT_FORBIDDEN");
});

test("a BHS credential cannot call the HBSS endpoint and secrets are never echoed", async () => {
  const secret = "bhs-only-super-secret";
  const response = await handleHbssIngestionRequest(
    ingestionRequest(availablePayload, secret),
    configuredHbssIngestion,
  );
  const serialized = JSON.stringify(await response.json());
  assert.equal(response.status, 401);
  assert.doesNotMatch(serialized, /bhs-only-super-secret|test-integration-key/);
});

test("ingestion returns 404 for an unknown BHS UID", async () => {
  const response = await handleHbssIngestionRequest(ingestionRequest(availablePayload), {
    ...configuredHbssIngestion,
    service: {
      async ingestScan() {
        throw new XrayNotFoundError("No bag matches the supplied BHS UID");
      },
    },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "No bag matches the supplied BHS UID",
    code: "XRAY_NOT_FOUND",
  });
});

test("ingestion service rejects an unknown BHS UID before writing", async () => {
  let repositoryCalled = false;
  const service = createXrayService({
    bagRepository: {
      async findById() {
        return null;
      },
      async findByBhsUid() {
        return null;
      },
    },
    repository: {
      async findLatestByBagId() {
        return null;
      },
      async findLatestByBhsUid() {
        return null;
      },
      async upsertFromAdapterResult() {
        repositoryCalled = true;
        return { scan: sampleScan(), disposition: "CREATED" };
      },
      async saveFailure() {
        repositoryCalled = true;
        return sampleScan();
      },
    },
    audit: () => undefined,
  });

  await assert.rejects(
    () => service.ingestScan(availablePayload),
    (error) =>
      error instanceof XrayNotFoundError && error.message === "No bag matches the supplied BHS UID",
  );
  assert.equal(repositoryCalled, false);
});

test("ingestion rejects a malformed image object", async () => {
  let serviceCalled = false;
  const malformedPayload = {
    ...availablePayload,
    images: [{ id: "side", label: "Side View", url: "/mock-xray/user/set-01/side.jpg" }],
  };
  const response = await handleHbssIngestionRequest(ingestionRequest(malformedPayload), {
    ...configuredHbssIngestion,
    service: {
      async ingestScan() {
        serviceCalled = true;
        return sampleScan();
      },
    },
  });

  assert.equal(response.status, 400);
  assert.equal(serviceCalled, false);
  assert.deepEqual(await response.json(), {
    error: "Invalid HBSS ingestion payload",
    code: "HBSS_PAYLOAD_INVALID",
  });
});
