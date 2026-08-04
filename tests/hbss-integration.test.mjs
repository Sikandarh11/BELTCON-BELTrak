import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  HBSS_FIXTURE_BHS_UID_A,
  HBSS_FIXTURE_BHS_UID_B,
  HBSS_FIXTURE_SITE,
  HBSS_FIXTURE_SOURCE,
  HBSS_SCAN_FIXTURES,
  createCanonicalHbssScan,
  createHbssImageView,
} from "./fixtures/hbssFixtures.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(repositoryRoot, "src") } },
});

test.after(async () => vite.close());

const [
  schemaModule,
  serviceModule,
  apiModule,
  repositoryModule,
  selectionModule,
  errorModule,
  viewerModule,
  emptyStateModule,
  statusModule,
  queryKeyModule,
  mockAdapterModule,
  smithsAdapterModule,
] = await Promise.all([
  vite.ssrLoadModule("/src/services/integrations/hbss/hbssSchemas.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayService.server.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayApi.server.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayRepository.server.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayScanSelection.ts"),
  vite.ssrLoadModule("/src/services/xray/xrayErrors.ts"),
  vite.ssrLoadModule("/src/components/xray/XrayViewer.tsx"),
  vite.ssrLoadModule("/src/components/xray/XrayEmptyState.tsx"),
  vite.ssrLoadModule("/src/components/xray/xrayStatusModel.ts"),
  vite.ssrLoadModule("/src/lib/queryKeys.ts"),
  vite.ssrLoadModule("/src/services/integrations/hbss/mockHbssAdapter.server.ts"),
  vite.ssrLoadModule("/src/services/integrations/hbss/smithsHbssAdapter.server.ts"),
]);

const { hbssScanResultSchema } = schemaModule;
const { createXrayService, resolveHbssRequestTimeoutMs } = serviceModule;
const {
  handleGetBagXrayRequest,
  handleHbssHealthRequest,
  handleHbssIngestionRequest,
  handleRefreshBagXrayRequest,
} = apiModule;
const { isExactHbssScanDuplicate } = repositoryModule;
const { scanForDisplay, selectXrayScans } = selectionModule;
const { HbssBhsUidMismatchError, XrayConflictError } = errorModule;
const { XrayViewer } = viewerModule;
const { XrayEmptyState } = emptyStateModule;
const { getXrayDisplayStatus } = statusModule;
const { hbssKeys } = queryKeyModule;
const { mockHbssAdapter } = mockAdapterModule;
const { smithsHbssAdapter } = smithsAdapterModule;

const binding = {
  integrationKey: "hbss-test-key",
  sourceSystem: HBSS_FIXTURE_SOURCE,
  siteId: HBSS_FIXTURE_SITE,
  enabled: true,
};

function clone(value) {
  return structuredClone(value);
}

function integrationRequest(
  payload,
  {
    key = binding.integrationKey,
    url = "http://localhost/api/integrations/hbss/scans",
    headers = {},
  } = {},
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hbss-integration-key": key,
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function operatorSession(role = "Operations Officer") {
  return {
    token: "session-token",
    expiresAt: "2026-08-02T12:00:00.000Z",
    user: {
      id: "HBSS-TEST-OFFICER",
      firstName: "HBSS",
      lastName: "Officer",
      email: "hbss-officer@example.test",
      role,
      createdAt: "2026-08-02T09:00:00.000Z",
      lastLogin: null,
    },
  };
}

function createMemoryState(bags = []) {
  return {
    bags: new Map(bags.map((bag) => [bag.id, { status: "IDENTIFIED", ...clone(bag) }])),
    scans: [],
    audits: [],
    adapterCalls: [],
    upsertCalls: 0,
    failureWrites: 0,
    sequence: 0,
  };
}

function storedScan(state, bagId, payload, overrides = {}) {
  state.sequence += 1;
  const timestamp = new Date(Date.UTC(2026, 7, 2, 10, 0, state.sequence)).toISOString();
  return {
    id: `XRAY-${String(state.sequence).padStart(6, "0")}`,
    bagId,
    bhsUid: payload.bhsUid,
    externalScanId: payload.externalScanId,
    sourceSystem: payload.sourceSystem,
    status: payload.status,
    images: clone(payload.images),
    threatLevel: payload.threatLevel ?? null,
    threatType: payload.threatType ?? null,
    capturedAt: payload.capturedAt ?? null,
    receivedAt: timestamp,
    errorCode: null,
    errorMessage: null,
    metadata: clone(payload.metadata ?? {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createMemorySystem({
  state = createMemoryState(),
  adapter,
  timeoutMs = 1_000,
  audit,
} = {}) {
  const repository = {
    async findSelectionByBagId(bagId) {
      return selectXrayScans(state.scans.filter((scan) => scan.bagId === bagId));
    },
    async findLatestByBagId(bagId) {
      return selectXrayScans(state.scans.filter((scan) => scan.bagId === bagId)).latestAttempt;
    },
    async findLatestByBhsUid(bhsUid) {
      return selectXrayScans(state.scans.filter((scan) => scan.bhsUid === bhsUid)).latestAttempt;
    },
    async upsertFromAdapterResult(bagId, expectedBhsUid, payload) {
      state.upsertCalls += 1;
      if (payload.bhsUid !== expectedBhsUid) throw new HbssBhsUidMismatchError();
      const existing = state.scans.find(
        (scan) =>
          scan.sourceSystem === payload.sourceSystem &&
          scan.externalScanId === payload.externalScanId,
      );
      if (existing) {
        if (existing.bagId !== bagId || existing.bhsUid !== expectedBhsUid) {
          throw new XrayConflictError("X-ray scan identity belongs to another bag");
        }
        if (!isExactHbssScanDuplicate(existing, bagId, expectedBhsUid, payload)) {
          throw new XrayConflictError(
            "X-ray scan identity was already received with a different payload",
          );
        }
        return { scan: existing, disposition: "DUPLICATE" };
      }
      const scan = storedScan(state, bagId, payload);
      state.scans.push(scan);
      return { scan, disposition: "CREATED" };
    },
    async saveFailure(bagId, bhsUid) {
      state.failureWrites += 1;
      const payload = createCanonicalHbssScan({
        externalScanId: null,
        bhsUid,
        sourceSystem: "HBSS",
        status: "FAILED",
        images: [],
        metadata: { failureRecorded: true },
      });
      const scan = storedScan(state, bagId, payload, {
        externalScanId: null,
        errorCode: "HBSS_RETRIEVAL_FAILED",
        errorMessage: "HBSS scan retrieval failed",
      });
      state.scans.push(scan);
      return scan;
    },
  };

  const bagRepository = {
    async findById(bagId) {
      const bag = state.bags.get(bagId);
      return bag ? { id: bag.id, bhsUid: bag.bhsUid ?? null } : null;
    },
    async findByBhsUid(bhsUid) {
      const matches = [...state.bags.values()].filter((bag) => bag.bhsUid === bhsUid);
      if (matches.length > 1) throw new XrayConflictError("Multiple bags match this BHS UID");
      const bag = matches[0];
      return bag ? { id: bag.id, bhsUid: bag.bhsUid } : null;
    },
  };

  const selectedAdapter = adapter ?? {
    name: "P2_HBSS_TEST",
    async getScanByBhsUid(bhsUid, options) {
      state.adapterCalls.push({ bhsUid, signal: options?.signal });
      return createCanonicalHbssScan({ bhsUid, externalScanId: `REFRESH-${bhsUid}` });
    },
    async healthCheck() {
      return { healthy: true };
    },
  };

  const service = createXrayService({
    repository,
    bagRepository,
    adapterFactory: () => selectedAdapter,
    requestTimeoutMs: () => timeoutMs,
    audit:
      audit ??
      ((event) => {
        state.audits.push(clone(event));
      }),
  });

  return { state, repository, bagRepository, adapter: selectedAdapter, service };
}

function authenticatedOptions(service, role = "Operations Officer") {
  return {
    service,
    async getSession() {
      return operatorSession(role);
    },
    viewAudit: {
      async recordViewed() {
        return "CREATED";
      },
    },
  };
}

function bagRequest(bagId, method = "GET", signal) {
  return new Request(
    `http://localhost/api/xray/bags/${bagId}${method === "POST" ? "/refresh" : ""}`,
    {
      method,
      signal,
      headers: { "x-xray-view-session-id": `view-${bagId}` },
    },
  );
}

test("P2-HBSS-001 Valid scan ingestion", async () => {
  for (const fixture of [
    HBSS_SCAN_FIXTURES.availableSingleImage,
    HBSS_SCAN_FIXTURES.pending,
    HBSS_SCAN_FIXTURES.missing,
    HBSS_SCAN_FIXTURES.failed,
    HBSS_SCAN_FIXTURES.archived,
  ]) {
    assert.equal(hbssScanResultSchema.safeParse(fixture).success, true, fixture.status);
  }
  assert.equal(
    hbssScanResultSchema.parse(createCanonicalHbssScan({ bhsUid: "0000000007" })).bhsUid,
    "0000000007",
  );

  const state = createMemoryState([
    { id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A, status: "IDENTIFIED" },
  ]);
  const { service } = createMemorySystem({ state });
  const response = await handleHbssIngestionRequest(
    integrationRequest({ ...HBSS_SCAN_FIXTURES.availableSingleImage, siteId: HBSS_FIXTURE_SITE }),
    { ...binding, service },
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(state.scans.length, 1);
  assert.equal(state.scans[0].bagId, "ETB-A");
  assert.equal(state.scans[0].bhsUid, HBSS_FIXTURE_BHS_UID_A);
  assert.equal(state.scans[0].externalScanId, "SCAN-000001");
  assert.equal(state.scans[0].sourceSystem, HBSS_FIXTURE_SOURCE);
  assert.equal(state.scans[0].metadata.integrationSiteId, HBSS_FIXTURE_SITE);
  assert.deepEqual(state.scans[0].images, HBSS_SCAN_FIXTURES.availableSingleImage.images);
  assert.equal(state.bags.get("ETB-A").status, "IDENTIFIED");
  assert.equal(body.scan.images[0].id, "IMAGE-001");
  assert.deepEqual(
    state.audits.map((event) => [event.action, event.sourceSystem]),
    [["XRAY_SCAN_RECEIVED", HBSS_FIXTURE_SOURCE]],
  );
});

test("P2-HBSS-002 Unknown BHS UID", async () => {
  const state = createMemoryState([
    { id: "ETB-SIMILAR", bhsUid: "1234567891" },
    { id: "ETB-A-LOCAL-SIMILAR", bhsUid: "2234567890" },
  ]);
  const { service } = createMemorySystem({ state });
  const response = await handleHbssIngestionRequest(
    integrationRequest(HBSS_SCAN_FIXTURES.availableSingleImage),
    { ...binding, service },
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "XRAY_NOT_FOUND");
  assert.equal(state.bags.size, 2);
  assert.equal(state.scans.length, 0);
  assert.equal(state.upsertCalls, 0);
  assert.equal(state.audits.length, 0);
});

test("P2-HBSS-003 Exact duplicate", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const { service } = createMemorySystem({ state });
  const request = () =>
    handleHbssIngestionRequest(integrationRequest(HBSS_SCAN_FIXTURES.duplicateExternalScanId), {
      ...binding,
      service,
    });
  assert.equal((await request()).status, 201);
  const first = clone(state.scans[0]);
  assert.equal((await request()).status, 201);
  assert.equal(state.scans.length, 1);
  assert.deepEqual(state.scans[0], first);
  assert.equal(state.scans[0].images.length, 1);
  assert.equal(state.audits.filter((event) => event.action === "XRAY_SCAN_RECEIVED").length, 1);
});

test("P2-HBSS-004 External scan conflict", async () => {
  const state = createMemoryState([
    { id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A },
    { id: "ETB-B", bhsUid: HBSS_FIXTURE_BHS_UID_B },
  ]);
  const { service } = createMemorySystem({ state });
  await service.ingestScan(HBSS_SCAN_FIXTURES.duplicateExternalScanId);
  const original = clone(state.scans[0]);

  for (const changed of [
    HBSS_SCAN_FIXTURES.changedPayloadForSameExternalScanId,
    createCanonicalHbssScan({
      externalScanId: "SCAN-000001",
      images: [createHbssImageView({ id: "IMAGE-CHANGED", url: "/mock-xray/changed-image.jpg" })],
    }),
    createCanonicalHbssScan({
      externalScanId: "SCAN-000001",
      metadata: { fixture: "changed-payload" },
    }),
  ]) {
    await assert.rejects(
      () => service.ingestScan(changed),
      (error) => error.code === "XRAY_CONFLICT" && error.status === 409,
    );
  }
  await assert.rejects(
    () =>
      service.ingestScan(
        createCanonicalHbssScan({
          externalScanId: "SCAN-000001",
          bhsUid: HBSS_FIXTURE_BHS_UID_B,
        }),
      ),
    (error) => error.code === "XRAY_CONFLICT",
  );
  assert.deepEqual(state.scans, [original]);
  assert.equal(state.failureWrites, 0);
  assert.equal(
    state.audits.filter(
      (event) =>
        event.action === "XRAY_SCAN_RETRIEVAL_FAILED" && event.errorCode === "XRAY_CONFLICT",
    ).length,
    4,
  );
});

test("P2-HBSS-005 Source spoof attempt", async () => {
  const calls = [];
  const service = {
    async ingestScan(payload) {
      calls.push(payload);
      return storedScan(createMemoryState(), "ETB-A", payload);
    },
  };
  const accepted = await handleHbssIngestionRequest(
    integrationRequest({
      ...HBSS_SCAN_FIXTURES.availableSingleImage,
      siteId: HBSS_FIXTURE_SITE,
      metadata: { requestedAdapter: "mock" },
    }),
    { ...binding, service },
  );
  assert.equal(accepted.status, 201);
  assert.equal(calls[0].sourceSystem, HBSS_FIXTURE_SOURCE);
  assert.equal(calls[0].metadata.integrationSiteId, HBSS_FIXTURE_SITE);
  assert.equal("siteId" in calls[0], false);

  for (const [request, options, expectedStatus] of [
    [integrationRequest(HBSS_SCAN_FIXTURES.availableSingleImage, { key: "" }), binding, 401],
    [integrationRequest(HBSS_SCAN_FIXTURES.availableSingleImage, { key: "wrong" }), binding, 401],
    [
      integrationRequest(HBSS_SCAN_FIXTURES.availableSingleImage),
      { ...binding, enabled: false },
      503,
    ],
    [
      integrationRequest({ ...HBSS_SCAN_FIXTURES.availableSingleImage, siteId: "JED" }),
      binding,
      400,
    ],
    [
      integrationRequest(HBSS_SCAN_FIXTURES.availableSingleImage, {
        url: "http://localhost/api/integrations/hbss/other",
      }),
      binding,
      403,
    ],
    [
      integrationRequest({
        ...HBSS_SCAN_FIXTURES.availableSingleImage,
        sourceSystem: "SPOOFED-HBSS",
      }),
      binding,
      400,
    ],
    [
      integrationRequest(HBSS_SCAN_FIXTURES.availableSingleImage),
      { ...binding, siteId: null },
      503,
    ],
  ]) {
    const response = await handleHbssIngestionRequest(request, { ...options, service });
    assert.equal(response.status, expectedStatus);
    assert.doesNotMatch(await response.text(), /hbss-test-key|wrong/);
  }

  const browserOnly = await handleHbssIngestionRequest(
    new Request("http://localhost/api/integrations/hbss/scans", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=browser" },
      body: JSON.stringify(HBSS_SCAN_FIXTURES.availableSingleImage),
    }),
    { ...binding, service },
  );
  assert.equal(browserOnly.status, 401);
  assert.equal(calls.length, 1);
});

test("P2-HBSS-006 Exact BHS UID correlation", async () => {
  const returnedValues = [
    ["1234567890", true],
    ["1234567891", false],
    ["123456789", false],
    ["12345678900", false],
    ["123456789X", false],
    ["0234567890", false],
    ["1234567890 ", false],
    [" 1234567890", false],
    [undefined, false],
    ["", false],
  ];

  for (const [returnedBhsUid, accepted] of returnedValues) {
    const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
    const raw = createCanonicalHbssScan();
    if (returnedBhsUid === undefined) delete raw.bhsUid;
    else raw.bhsUid = returnedBhsUid;
    const adapter = {
      name: "CORRELATION_TEST",
      async getScanByBhsUid(bhsUid, options) {
        state.adapterCalls.push({ bhsUid, signal: options.signal });
        return raw;
      },
      async healthCheck() {
        return { healthy: true };
      },
    };
    const { service } = createMemorySystem({ state, adapter });
    if (accepted) {
      await service.refreshScanForBag("ETB-A");
      assert.equal(state.scans.length, 1);
    } else {
      await assert.rejects(
        () => service.refreshScanForBag("ETB-A"),
        (error) => error.code === "HBSS_BHS_UID_MISMATCH",
      );
      assert.equal(state.scans.length, 0);
      assert.equal(state.upsertCalls, 0);
      assert.equal(state.failureWrites, 0);
      assert.equal(state.audits.at(-1).errorCode, "HBSS_BHS_UID_MISMATCH");
    }
    assert.deepEqual(
      state.adapterCalls.map((call) => call.bhsUid),
      [HBSS_FIXTURE_BHS_UID_A],
    );
  }
});

test("P2-HBSS-007 Case-different BHS UID", async () => {
  const state = createMemoryState([{ id: "ETB-CASE", bhsUid: "abcdefghij" }]);
  const adapter = {
    name: "CASE_TEST",
    async getScanByBhsUid() {
      return createCanonicalHbssScan({ bhsUid: "ABCDEFGHIJ" });
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
  const { service } = createMemorySystem({ state, adapter });
  await assert.rejects(
    () => service.refreshScanForBag("ETB-CASE"),
    (error) => error.code === "HBSS_BHS_UID_MISMATCH",
  );
  assert.equal(state.scans.length, 0);
});

test("P2-HBSS-008 Cross-bag image protection", async () => {
  const [scanA, scanB] = HBSS_SCAN_FIXTURES.differentBagScans.map(clone);
  const state = createMemoryState([
    { id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A, iataCode: "1111111111" },
    { id: "ETB-B", bhsUid: HBSS_FIXTURE_BHS_UID_B, iataCode: "2222222222" },
  ]);
  const adapter = {
    name: "TWO_BAG_TEST",
    async getScanByBhsUid(bhsUid, options) {
      state.adapterCalls.push({ bhsUid, signal: options.signal });
      return clone(bhsUid === HBSS_FIXTURE_BHS_UID_A ? scanA : scanB);
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
  const { service } = createMemorySystem({ state, adapter });
  const [responseA, responseB] = await Promise.all([
    handleRefreshBagXrayRequest(
      bagRequest("ETB-A", "POST"),
      "ETB-A",
      authenticatedOptions(service),
    ),
    handleRefreshBagXrayRequest(
      bagRequest("ETB-B", "POST"),
      "ETB-B",
      authenticatedOptions(service),
    ),
  ]);
  const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]);
  assert.deepEqual(
    bodyA.displayScan.images.map((image) => image.id),
    ["IMAGE-A"],
  );
  assert.deepEqual(
    bodyB.displayScan.images.map((image) => image.id),
    ["IMAGE-B"],
  );
  assert.doesNotMatch(JSON.stringify(bodyA), /IMAGE-B|bag-b\.jpg/);
  assert.doesNotMatch(JSON.stringify(bodyB), /IMAGE-A|bag-a\.jpg/);
  assert.deepEqual(state.scans.map((scan) => [scan.bagId, scan.bhsUid, scan.images[0].id]).sort(), [
    ["ETB-A", HBSS_FIXTURE_BHS_UID_A, "IMAGE-A"],
    ["ETB-B", HBSS_FIXTURE_BHS_UID_B, "IMAGE-B"],
  ]);
  assert.notDeepEqual(hbssKeys.xraySelection("ETB-A"), hbssKeys.xraySelection("ETB-B"));
  const bagBHtml = renderToStaticMarkup(
    createElement(XrayViewer, { bagId: "ETB-B", scan: bodyB.displayScan }),
  );
  assert.match(bagBHtml, /bag-b\.jpg/);
  assert.doesNotMatch(bagBHtml, /bag-a\.jpg|IMAGE-A/);

  const wrongState = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const wrongSystem = createMemorySystem({
    state: wrongState,
    adapter: {
      ...adapter,
      async getScanByBhsUid() {
        return scanB;
      },
    },
  });
  await assert.rejects(
    () => wrongSystem.service.refreshScanForBag("ETB-A"),
    (error) => error.code === "HBSS_BHS_UID_MISMATCH",
  );
  assert.equal(wrongState.scans.length, 0);
});

test("P2-HBSS-009 Available refresh", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const { service } = createMemorySystem({ state });
  const response = await handleRefreshBagXrayRequest(
    bagRequest("ETB-A", "POST"),
    "ETB-A",
    authenticatedOptions(service),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(state.adapterCalls[0].bhsUid, HBSS_FIXTURE_BHS_UID_A);
  assert.equal(body.latestAttempt.status, "AVAILABLE");
  assert.equal(body.displayScan.id, body.latestAttempt.id);
  assert.deepEqual(
    state.audits.map((event) => event.action),
    ["XRAY_REFRESH_REQUESTED", "XRAY_SCAN_RECEIVED"],
  );
});

test("P2-HBSS-010 Pending refresh", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  state.scans.push(storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.olderForSameBhsUid));
  const adapter = {
    name: "PENDING_TEST",
    async getScanByBhsUid() {
      return clone(HBSS_SCAN_FIXTURES.pending);
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
  const { service } = createMemorySystem({ state, adapter });
  await service.refreshScanForBag("ETB-A");
  const selection = await service.getScanSelectionForBag("ETB-A");
  assert.equal(selection.latestAttempt.status, "PENDING");
  assert.equal(selection.displayScan.status, "AVAILABLE");
  assert.notEqual(selection.latestAttempt.id, selection.displayScan.id);
  assert.equal(getXrayDisplayStatus(selection.latestAttempt), "Pending");
});

test("P2-HBSS-011 Missing image", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const adapter = {
    name: "MISSING_TEST",
    async getScanByBhsUid() {
      return clone(HBSS_SCAN_FIXTURES.missing);
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
  const { service } = createMemorySystem({ state, adapter });
  await assert.rejects(
    () => service.refreshScanForBag("ETB-A"),
    (error) => error.code === "XRAY_NOT_FOUND" && error.status === 404,
  );
  const selection = await service.getScanSelectionForBag("ETB-A");
  assert.equal(selection.latestAttempt.status, "NOT_FOUND");
  assert.equal(selection.displayScan, null);
  assert.equal(selection.latestAttempt.images.length, 0);
  const html = renderToStaticMarkup(
    createElement(XrayEmptyState, { kind: "missing", showManualInspectionWarning: true }),
  );
  assert.match(html, /manual inspection/i);
});

test("P2-HBSS-012 Failed refresh", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  state.scans.push(storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.olderForSameBhsUid));
  const adapter = {
    name: "FAILED_TEST",
    async getScanByBhsUid() {
      return clone(HBSS_SCAN_FIXTURES.failed);
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
  const { service } = createMemorySystem({ state, adapter });
  const response = await handleRefreshBagXrayRequest(
    bagRequest("ETB-A", "POST"),
    "ETB-A",
    authenticatedOptions(service),
  );
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.code, "XRAY_ADAPTER_ERROR");
  assert.doesNotMatch(JSON.stringify(body), /stack|FAILED_TEST/);
  const selection = await service.getScanSelectionForBag("ETB-A");
  assert.equal(selection.latestAttempt.status, "FAILED");
  assert.equal(selection.displayScan.status, "AVAILABLE");
});

test("P2-HBSS-013 Archived image", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const { service } = createMemorySystem({ state });
  await service.ingestScan(HBSS_SCAN_FIXTURES.archived);
  const selection = await service.getScanSelectionForBag("ETB-A");
  assert.equal(selection.latestAttempt.status, "ARCHIVED");
  assert.equal(selection.displayScan, null);
  assert.equal(getXrayDisplayStatus(selection.latestAttempt), "Archived");
  const html = renderToStaticMarkup(
    createElement(XrayEmptyState, { kind: "archived", showManualInspectionWarning: true }),
  );
  assert.match(html, /archived/i);
  assert.match(html, /manual inspection/i);
});

test("P2-HBSS-014 Missing bag BHS UID", async () => {
  const state = createMemoryState([{ id: "ETB-NO-BHS", bhsUid: null }]);
  const { service } = createMemorySystem({ state });
  const response = await handleRefreshBagXrayRequest(
    bagRequest("ETB-NO-BHS", "POST"),
    "ETB-NO-BHS",
    authenticatedOptions(service),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "BHS_UID_REQUIRED");
  assert.equal(state.adapterCalls.length, 0);
  assert.equal(state.scans.length, 0);
  assert.equal(state.failureWrites, 0);
  assert.equal(state.audits.at(-1).errorCode, "BAG_BHS_UID_MISSING");
});

test("P2-HBSS-015 Adapter timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal(resolveHbssRequestTimeoutMs(undefined), 10_000);
  for (const invalid of ["abc", "99", "120001", "-1", "1.5"]) {
    assert.throws(() => resolveHbssRequestTimeoutMs(invalid), /HBSS request timeout/);
  }

  const boundaryState = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  let boundarySignal;
  const boundarySystem = createMemorySystem({
    state: boundaryState,
    timeoutMs: 100,
    adapter: {
      name: "BOUNDARY_TEST",
      getScanByBhsUid(_bhsUid, options) {
        boundarySignal = options.signal;
        return new Promise((resolve) =>
          setTimeout(() => resolve(clone(HBSS_SCAN_FIXTURES.availableSingleImage)), 100),
        );
      },
      async healthCheck() {
        return { healthy: true };
      },
    },
  });
  const boundaryAssertion = assert.rejects(
    boundarySystem.service.refreshScanForBag("ETB-A"),
    (error) => error.code === "HBSS_REQUEST_TIMED_OUT",
  );
  while (!boundarySignal) await Promise.resolve();
  t.mock.timers.tick(100);
  await boundaryAssertion;
  assert.equal(boundarySignal.aborted, true);
  assert.equal(boundaryState.scans.length, 0);
  assert.equal(boundaryState.audits.at(-1).errorCode, "HBSS_REQUEST_TIMED_OUT");

  const rejectState = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const rejectSystem = createMemorySystem({
    state: rejectState,
    adapter: {
      name: "REJECT_TEST",
      async getScanByBhsUid() {
        throw new Error("vendor stack secret");
      },
      async healthCheck() {
        return { healthy: false };
      },
    },
  });
  await assert.rejects(
    () => rejectSystem.service.refreshScanForBag("ETB-A"),
    (error) => error.code === "XRAY_ADAPTER_ERROR" && !error.message.includes("vendor stack"),
  );
});

test("P2-HBSS-016 Late-result protection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  let finishLate;
  let adapterSignal;
  const system = createMemorySystem({
    state,
    timeoutMs: 100,
    adapter: {
      name: "LATE_TEST",
      getScanByBhsUid(_bhsUid, options) {
        adapterSignal = options.signal;
        return new Promise((resolve) => {
          finishLate = resolve;
        });
      },
      async healthCheck() {
        return { healthy: true };
      },
    },
  });
  const timedOut = assert.rejects(
    system.service.refreshScanForBag("ETB-A"),
    (error) => error.code === "HBSS_REQUEST_TIMED_OUT",
  );
  while (!finishLate) await Promise.resolve();
  t.mock.timers.tick(100);
  await timedOut;
  finishLate(clone(HBSS_SCAN_FIXTURES.availableSingleImage));
  await Promise.resolve();
  assert.equal(adapterSignal.aborted, true);
  assert.equal(state.scans.length, 0);

  const retry = createMemorySystem({ state });
  await retry.service.refreshScanForBag("ETB-A");
  await retry.service.refreshScanForBag("ETB-A");
  assert.equal(state.scans.length, 1);

  const cancelState = createMemoryState([{ id: "ETB-CANCEL", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  let cancelSignal;
  let finishCancelled;
  const cancelSystem = createMemorySystem({
    state: cancelState,
    adapter: {
      name: "CANCEL_TEST",
      getScanByBhsUid(_bhsUid, options) {
        cancelSignal = options.signal;
        return new Promise((resolve) => {
          finishCancelled = resolve;
        });
      },
      async healthCheck() {
        return { healthy: true };
      },
    },
  });
  const controller = new AbortController();
  const responsePromise = handleRefreshBagXrayRequest(
    bagRequest("ETB-CANCEL", "POST", controller.signal),
    "ETB-CANCEL",
    authenticatedOptions(cancelSystem.service),
  );
  while (!cancelSignal) await Promise.resolve();
  controller.abort();
  const response = await responsePromise;
  assert.equal(response.status, 499);
  assert.equal((await response.json()).code, "XRAY_REQUEST_CANCELLED");
  assert.equal(cancelSignal.aborted, true);
  finishCancelled(clone(HBSS_SCAN_FIXTURES.availableSingleImage));
  await Promise.resolve();
  assert.equal(cancelState.scans.length, 0);
});

test("P2-HBSS-017 Scan selection", () => {
  const state = createMemoryState();
  const oldAvailable = storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.olderForSameBhsUid);
  const pending = storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.pending);
  const failed = storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.failed);
  const missing = storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.missing);
  const archived = storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.archived);
  const newestAvailable = storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.newerForSameBhsUid, {
    receivedAt: "2026-08-02T11:00:00.000Z",
    createdAt: "2026-08-02T11:00:00.000Z",
  });
  const selection = selectXrayScans([
    oldAvailable,
    pending,
    failed,
    missing,
    archived,
    newestAvailable,
  ]);
  assert.equal(selection.latestAttempt.id, newestAvailable.id);
  assert.equal(selection.displayScan.id, newestAvailable.id);
  assert.equal(scanForDisplay(selection).id, newestAvailable.id);

  const failureAfterAvailable = selectXrayScans([
    oldAvailable,
    { ...failed, receivedAt: "2026-08-02T12:00:00.000Z" },
  ]);
  assert.equal(failureAfterAvailable.latestAttempt.status, "FAILED");
  assert.equal(failureAfterAvailable.displayScan.status, "AVAILABLE");
  const tied = selectXrayScans([
    { ...oldAvailable, id: "A", receivedAt: "2026-08-02T12:00:00.000Z", createdAt: "invalid" },
    { ...pending, id: "B", receivedAt: "2026-08-02T12:00:00.000Z", createdAt: "invalid" },
  ]);
  assert.equal(tied.latestAttempt.id, "B");
  assert.equal(HBSS_SCAN_FIXTURES.availableMultipleImages.images.length, 2);
});

test("P2-HBSS-018 Image metadata security", async () => {
  const invalidFixtures = [
    HBSS_SCAN_FIXTURES.missingExternalScanId,
    HBSS_SCAN_FIXTURES.missingBhsUid,
    createCanonicalHbssScan({ bhsUid: "123456789" }),
    createCanonicalHbssScan({ bhsUid: "ETB-123456" }),
    createCanonicalHbssScan({ status: "UNKNOWN" }),
    HBSS_SCAN_FIXTURES.invalidCapturedTimestamp,
    HBSS_SCAN_FIXTURES.unsupportedMimeType,
    HBSS_SCAN_FIXTURES.invalidStoragePath,
    HBSS_SCAN_FIXTURES.invalidUrl,
    HBSS_SCAN_FIXTURES.emptyImageList,
    HBSS_SCAN_FIXTURES.oversizedMetadata,
    HBSS_SCAN_FIXTURES.unexpectedFields,
    HBSS_SCAN_FIXTURES.prototypePollutionFields,
    HBSS_SCAN_FIXTURES.corruptedImageMetadata,
    createCanonicalHbssScan({ externalScanId: null }),
    createCanonicalHbssScan({ images: [createHbssImageView({ url: "file:///C:/secret.txt" })] }),
    createCanonicalHbssScan({
      images: [createHbssImageView({ url: "https://untrusted.example/image.jpg" })],
    }),
  ];
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const { service } = createMemorySystem({ state });
  for (const fixture of invalidFixtures) {
    assert.equal(hbssScanResultSchema.safeParse(fixture).success, false);
    const response = await handleHbssIngestionRequest(integrationRequest(fixture), {
      ...binding,
      service,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "HBSS_PAYLOAD_INVALID");
  }
  assert.equal(state.scans.length, 0);
  assert.equal(state.upsertCalls, 0);
  assert.equal(state.audits.length, 0);

  const oversizedBody = await handleHbssIngestionRequest(
    integrationRequest(createCanonicalHbssScan({ metadata: { value: "x".repeat(257 * 1024) } })),
    { ...binding, service },
  );
  assert.equal(oversizedBody.status, 413);
  assert.equal((await oversizedBody.json()).code, "HBSS_PAYLOAD_TOO_LARGE");
  const viewerSource = await readFile(
    path.join(repositoryRoot, "src/components/xray/XrayViewer.tsx"),
    "utf8",
  );
  assert.doesNotMatch(viewerSource, /dangerouslySetInnerHTML|innerHTML/);
});

test("P2-HBSS-019 PostgreSQL atomicity harness coverage", async () => {
  const [postgresTest, migration006, migration025] = await Promise.all([
    readFile(
      path.join(repositoryRoot, "tests/postgres/bhs-hbss-integrity.postgres.test.mjs"),
      "utf8",
    ),
    readFile(path.join(repositoryRoot, "supabase/migrations/006_create_xray_scans.sql"), "utf8"),
    readFile(
      path.join(repositoryRoot, "supabase/migrations/025_bhs_hbss_integrity_hardening.sql"),
      "utf8",
    ),
  ]);
  assert.match(migration006, /UNIQUE INDEX idx_xray_scans_source_external/);
  assert.match(migration025, /xray_scans_bag_bhs_uid_correlation/);
  assert.match(
    migration025,
    /REVOKE INSERT, UPDATE, DELETE ON public\.xray_scans FROM anon, authenticated/,
  );
  for (const requirement of [
    /P2-HBSS-019 valid direct scan insert/,
    /P2-HBSS-019 exact direct duplicate remains one row/,
    /P2-HBSS-019 concurrent direct duplicate remains one row/,
    /P2-HBSS-019 direct correlation and role protections/,
  ]) {
    assert.match(postgresTest, requirement);
  }
});

test("P2-HBSS-020 Concurrent ingestion", async () => {
  const state = createMemoryState([
    { id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A },
    { id: "ETB-B", bhsUid: HBSS_FIXTURE_BHS_UID_B },
  ]);
  const { service } = createMemorySystem({ state });
  const duplicateResults = await Promise.all(
    Array.from({ length: 50 }, () => service.ingestScan(HBSS_SCAN_FIXTURES.availableSingleImage)),
  );
  assert.equal(duplicateResults.length, 50);
  assert.equal(state.scans.length, 1);
  const different = Array.from({ length: 25 }, (_, index) =>
    createCanonicalHbssScan({
      externalScanId: `SCAN-CONCURRENT-${String(index).padStart(3, "0")}`,
    }),
  );
  await Promise.all(different.map((scan) => service.ingestScan(scan)));
  await service.ingestScan(HBSS_SCAN_FIXTURES.differentBagScans[1]);
  assert.equal(state.scans.filter((scan) => scan.bagId === "ETB-A").length, 26);
  assert.equal(state.scans.filter((scan) => scan.bagId === "ETB-B").length, 1);
  assert.equal(
    state.scans.some((scan) => scan.bagId === "ETB-A" && scan.bhsUid !== HBSS_FIXTURE_BHS_UID_A),
    false,
  );
});

test("P2-HBSS-021 Health endpoint", async () => {
  const mockHealth = await handleHbssHealthRequest({
    service: createXrayService({ adapterFactory: () => mockHbssAdapter, audit: () => undefined }),
  });
  assert.equal(mockHealth.status, 200);
  assert.equal((await mockHealth.json()).status, "SIMULATED");

  for (const adapter of [
    {
      name: "DEGRADED",
      async healthCheck() {
        return { healthy: false, message: "secret" };
      },
    },
    {
      name: "UNAVAILABLE",
      async healthCheck() {
        throw new Error("vendor stack");
      },
    },
    smithsHbssAdapter,
  ]) {
    const response = await handleHbssHealthRequest({
      service: createXrayService({ adapterFactory: () => adapter, audit: () => undefined }),
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, "UNAVAILABLE");
    assert.deepEqual(Object.keys(body).sort(), [
      "adapter",
      "healthy",
      "lastChecked",
      "message",
      "status",
    ]);
    assert.doesNotMatch(JSON.stringify(body), /credential|integrationKey|vendor stack|secret/i);
  }

  const missing = await handleHbssHealthRequest({
    service: createXrayService({
      adapterFactory: () => {
        throw new Error("missing");
      },
      audit: () => undefined,
    }),
  });
  assert.equal(missing.status, 503);
  assert.throws(() => resolveHbssRequestTimeoutMs("invalid"), /timeout/);
  const invalidTimeout = await handleHbssHealthRequest({
    service: createXrayService({
      adapterFactory: () => mockHbssAdapter,
      requestTimeoutMs: () => resolveHbssRequestTimeoutMs("invalid"),
      audit: () => undefined,
    }),
  });
  assert.equal(invalidTimeout.status, 503);
  assert.match((await invalidTimeout.json()).message, /timeout configuration is invalid/i);
});

test("P2-HBSS-022 Viewer stale-image protection", async () => {
  const [scanA, scanB] = HBSS_SCAN_FIXTURES.differentBagScans;
  const stateA = createMemoryState();
  const storedA = storedScan(stateA, "ETB-A", scanA);
  const storedB = storedScan(stateA, "ETB-B", scanB);
  const htmlA = renderToStaticMarkup(createElement(XrayViewer, { bagId: "ETB-A", scan: storedA }));
  const htmlB = renderToStaticMarkup(createElement(XrayViewer, { bagId: "ETB-B", scan: storedB }));
  assert.match(htmlA, /bag-a\.jpg/);
  assert.doesNotMatch(htmlB, /bag-a\.jpg/);
  assert.match(htmlB, /bag-b\.jpg/);

  const [viewerSource, recheckSource, clientSource] = await Promise.all([
    readFile(path.join(repositoryRoot, "src/components/xray/XrayViewer.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/routes/recheck.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/services/xray/xrayClient.ts"), "utf8"),
  ]);
  assert.match(viewerSource, /\[bagId, scan\.id, imageSignature\]/);
  assert.match(recheckSource, /xrayRefreshInFlightRef\.current/);
  assert.match(recheckSource, /scan=\{xraySelection\.displayScan\}/);
  assert.doesNotMatch(recheckSource, /scan=\{refreshXray\.(?:data|result)\}/);
  assert.match(clientSource, /hbssKeys\.xraySelection\(bagId \?\? ""\)/);
});

test("P2-HBSS-023 Authorization", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  state.scans.push(storedScan(state, "ETB-A", HBSS_SCAN_FIXTURES.availableSingleImage));
  const { service } = createMemorySystem({ state });

  const unauthenticated = await handleGetBagXrayRequest(bagRequest("ETB-A"), "ETB-A", {
    service,
    async getSession() {
      return null;
    },
  });
  assert.equal(unauthenticated.status, 401);

  for (const handler of [
    () =>
      handleGetBagXrayRequest(
        bagRequest("ETB-A"),
        "ETB-A",
        authenticatedOptions(service, "Tagging Operator"),
      ),
    () =>
      handleRefreshBagXrayRequest(
        bagRequest("ETB-A", "POST"),
        "ETB-A",
        authenticatedOptions(service, "Tagging Operator"),
      ),
  ]) {
    const response = await handler();
    assert.equal(response.status, 403);
  }
  assert.equal(state.adapterCalls.length, 0);
  assert.equal(state.scans.length, 1);
});

test("P2-HBSS-024 Restart recovery", async () => {
  const state = createMemoryState([{ id: "ETB-A", bhsUid: HBSS_FIXTURE_BHS_UID_A }]);
  const firstProcess = createMemorySystem({ state });
  await firstProcess.service.ingestScan(HBSS_SCAN_FIXTURES.availableSingleImage);
  const committed = clone(state.scans[0]);

  const restartedProcess = createMemorySystem({ state });
  const selection = await restartedProcess.service.getScanSelectionForBag("ETB-A");
  assert.deepEqual(selection.displayScan, committed);
  await restartedProcess.service.ingestScan(HBSS_SCAN_FIXTURES.availableSingleImage);
  assert.equal(state.scans.length, 1);
  assert.deepEqual(state.scans[0], committed);

  await restartedProcess.service.ingestScan(HBSS_SCAN_FIXTURES.pending);
  const afterPendingRestart = createMemorySystem({ state });
  const pendingSelection = await afterPendingRestart.service.getScanSelectionForBag("ETB-A");
  assert.equal(pendingSelection.latestAttempt.status, "PENDING");
  assert.equal(pendingSelection.displayScan.status, "AVAILABLE");

  const committedBeforeResponse = await afterPendingRestart.repository.upsertFromAdapterResult(
    "ETB-A",
    HBSS_FIXTURE_BHS_UID_A,
    HBSS_SCAN_FIXTURES.newerForSameBhsUid,
  );
  assert.equal(committedBeforeResponse.disposition, "CREATED");
  const afterLostResponseRestart = createMemorySystem({ state });
  const retry = await afterLostResponseRestart.service.ingestScan(
    HBSS_SCAN_FIXTURES.newerForSameBhsUid,
  );
  assert.equal(retry.id, committedBeforeResponse.scan.id);
  assert.equal(state.scans.filter((scan) => scan.externalScanId === "SCAN-000007").length, 1);
  const html = renderToStaticMarkup(
    createElement(XrayViewer, {
      bagId: "ETB-A",
      scan: (await afterLostResponseRestart.service.getScanSelectionForBag("ETB-A")).displayScan,
    }),
  );
  assert.match(html, /scan-000001-side\.jpg/);
});

test("P2-HBSS-025 Software load", async () => {
  const bags = Array.from({ length: 100 }, (_, index) => ({
    id: `ETB-LOAD-${String(index).padStart(3, "0")}`,
    bhsUid: String(index + 1).padStart(10, "0"),
  }));
  const state = createMemoryState(bags);
  const { service } = createMemorySystem({ state });
  const statuses = ["AVAILABLE", "PENDING", "NOT_FOUND", "FAILED"];
  const scans = bags.map((bag, index) => {
    const status = statuses[index % statuses.length];
    return createCanonicalHbssScan({
      externalScanId: `LOAD-SCAN-${String(index).padStart(3, "0")}`,
      bhsUid: bag.bhsUid,
      status,
      images: status === "AVAILABLE" ? [createHbssImageView({ id: `LOAD-IMAGE-${index}` })] : [],
    });
  });
  const startedAt = performance.now();
  const accepted = await Promise.all(scans.map((scan) => service.ingestScan(scan)));
  const duplicates = await Promise.all(
    Array.from({ length: 100 }, () => service.ingestScan(scans[0])),
  );
  const concurrentDifferent = await Promise.all(
    scans.slice(0, 50).map((scan) => service.ingestScan(scan)),
  );
  const refreshed = await Promise.all(
    bags.slice(0, 50).map((bag) => service.refreshScanForBag(bag.id)),
  );
  const repeatedRefreshes = await Promise.all(
    Array.from({ length: 10 }, () => service.refreshScanForBag(bags[0].id)),
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(accepted.length, 100);
  assert.equal(duplicates.length, 100);
  assert.equal(concurrentDifferent.length, 50);
  assert.equal(refreshed.length, 50);
  assert.equal(repeatedRefreshes.length, 10);
  assert.equal(state.scans.length, 150);
  assert.equal(
    new Set(state.scans.map((scan) => `${scan.sourceSystem}:${scan.externalScanId}`)).size,
    150,
  );
  assert.equal(
    state.scans.filter((scan) => state.bags.get(scan.bagId)?.bhsUid !== scan.bhsUid).length,
    0,
  );
  assert.equal(state.audits.filter((event) => event.action === "XRAY_SCAN_RECEIVED").length, 150);
  assert.equal(
    state.audits.filter((event) => event.action === "XRAY_REFRESH_REQUESTED").length,
    60,
  );
  assert.equal(
    state.audits.filter((event) => event.errorCode === "HBSS_REQUEST_TIMED_OUT").length,
    0,
  );
  assert.ok(Number.isFinite(elapsedMs));
});
