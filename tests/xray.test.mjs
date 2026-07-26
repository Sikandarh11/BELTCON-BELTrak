import assert from "node:assert/strict";
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
]);

const { mapXrayScanRow } = repositoryModule;
const { createXrayService } = serviceModule;
const { handleHbssIngestionRequest } = apiModule;
const { XrayNotFoundError, XrayValidationError } = errorModule;
const { getXrayDisplayStatus } = statusModelModule;
const { XrayViewer } = viewerModule;
const { bagToRow, rowToBag } = bagMappingsModule;
const { screeningEventV1Schema } = screeningModule;
const { hbssScanResultSchema } = hbssSchemasModule;

const availablePayload = {
  bhsUid: "BHS-2026-000123",
  externalScanId: "SCAN-88721",
  sourceSystem: "MOCK_HBSS",
  status: "AVAILABLE",
  images: [
    {
      id: "side",
      label: "Side View",
      url: "/mock-xray/scan-side.svg",
      mimeType: "image/svg+xml",
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
    bhsUid: "BHS-2026-000123",
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

test("mock adapter returns an available response with image views", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("BHS-NORMAL-001");
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.images.length, 3);
});

test("mock adapter returns PENDING", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("BHS-PENDING-001");
  assert.equal(result.status, "PENDING");
  assert.deepEqual(result.images, []);
});

test("mock adapter returns NOT_FOUND", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("BHS-MISSING-001");
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.images, []);
});

test("mock adapter returns FAILED", async () => {
  const result = await mockHbssAdapter.getScanByBhsUid("BHS-FAIL-001");
  assert.equal(result.status, "FAILED");
  assert.deepEqual(result.images, []);
});

test("mock adapter is deterministic for the same BHS UID", async () => {
  const first = await mockHbssAdapter.getScanByBhsUid("BHS-NORMAL-001");
  const second = await mockHbssAdapter.getScanByBhsUid("BHS-NORMAL-001");
  assert.deepEqual(second, first);
});

test("bag row mapping round-trips screening and identity fields", () => {
  const bag = {
    id: "ETB-000123",
    sourceSystem: "SIMULATED_HBSS",
    bhsUid: "BHS-2026-000123",
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
    bhsUid: "BHS-2026-000125",
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
  assert.equal(getXrayDisplayStatus(sampleScan({ status: "ARCHIVED" })), "Not requested");
  assert.equal(getXrayDisplayStatus(null), "Not requested");
});

test("X-ray viewer renders real image views with accessible controls", () => {
  const scan = sampleScan({
    images: [
      availablePayload.images[0],
      {
        id: "top",
        label: "Top View",
        url: "/mock-xray/scan-top.svg",
        mimeType: "image/svg+xml",
      },
      {
        id: "density",
        label: "Density View",
        url: "/mock-xray/scan-density.svg",
        mimeType: "image/svg+xml",
      },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(XrayViewer, {
      bagId: "ETB-000123",
      scan,
    }),
  );

  assert.match(html, /src="\/mock-xray\/scan-side\.svg"/);
  assert.match(html, /alt="Side View for bag ETB-000123"/);
  assert.match(html, /1 \/ 3/);
  assert.match(html, /aria-label="Previous X-ray view"/);
  assert.match(html, /aria-label="Next X-ray view"/);
  assert.match(html, /aria-label="Zoom in"/);
  assert.match(html, /aria-label="Rotate X-ray clockwise"/);
  assert.match(html, /aria-label="Reset X-ray view"/);
});

test("repository maps snake_case rows to the X-ray domain model", () => {
  const mapped = mapXrayScanRow({
    id: "00000000-0000-4000-8000-000000000001",
    bag_id: "ETB-000123",
    bhs_uid: "BHS-2026-000123",
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

test("refresh loads a bag BHS UID, calls the adapter, and persists the result", async () => {
  let persistedBagId;
  let persistedResult;
  const auditEvents = [];
  const storedScan = sampleScan();

  const service = createXrayService({
    bagRepository: {
      async findById() {
        return { id: "ETB-000123", bhsUid: "BHS-2026-000123" };
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
      async upsertFromAdapterResult(bagId, result) {
        persistedBagId = bagId;
        persistedResult = result;
        return storedScan;
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
  assert.equal(persistedResult.bhsUid, "BHS-2026-000123");
  assert.deepEqual(
    auditEvents.map((event) => event.action),
    ["XRAY_REFRESH_REQUESTED", "XRAY_SCAN_RECEIVED"],
  );
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
    (error) => error instanceof XrayValidationError && error.message === "Bag has no BHS UID",
  );
  assert.equal(adapterCalled, false);
});

test("ingestion rejects an invalid integration key", async () => {
  let serviceCalled = false;
  const response = await handleHbssIngestionRequest(
    ingestionRequest(availablePayload, "wrong-key"),
    {
      integrationKey: "test-integration-key",
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
    integrationKey: "test-integration-key",
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

test("ingestion returns 404 for an unknown BHS UID", async () => {
  const response = await handleHbssIngestionRequest(ingestionRequest(availablePayload), {
    integrationKey: "test-integration-key",
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
        return sampleScan();
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
    images: [{ id: "side", label: "Side View", url: "/mock-xray/scan-side.svg" }],
  };
  const response = await handleHbssIngestionRequest(ingestionRequest(malformedPayload), {
    integrationKey: "test-integration-key",
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
