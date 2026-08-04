import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(root, "src") } },
});
test.after(async () => vite.close());

const [readerApi, readerServiceModule, reportApi, auditApi, queryKeys, authorization] =
  await Promise.all([
    vite.ssrLoadModule("/src/services/readers/readerApi.server.ts"),
    vite.ssrLoadModule("/src/services/readers/readerService.server.ts"),
    vite.ssrLoadModule("/src/services/reports/operationalReportApi.server.ts"),
    vite.ssrLoadModule("/src/services/audit/auditApi.server.ts"),
    vite.ssrLoadModule("/src/lib/queryKeys.ts"),
    vite.ssrLoadModule("/src/services/authorization/permissionAuthorization.server.ts"),
  ]);

const NOW = "2026-07-28T12:00:00.000Z";
const session = {
  token: "test-token",
  expiresAt: NOW,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@beltcon.test",
    firstName: "System",
    lastName: "Administrator",
    role: "System Administrator",
    status: "ACTIVE",
    isActive: true,
    mustChangePassword: false,
    createdAt: NOW,
    lastLogin: NOW,
  },
};
const allow = async (_session, permission) => ({
  canonicalRole: session.user.role,
  permissions: [permission],
  authorizationVersion: 1,
});
const deny = async () => {
  throw new authorization.PermissionAuthorizationError("Denied", "PERMISSION_DENIED", 403);
};
const reader = {
  id: "RDR-001",
  readerCode: "RDR-001",
  name: "Reader 1",
  model: null,
  vendor: null,
  firmwareVersion: null,
  enabled: true,
  configuredStatus: "ONLINE",
  calculatedHealth: "UNKNOWN",
  lastSeenAt: null,
  lastReadAt: null,
  antennaCount: 1,
  activeAntennaCount: 1,
  mappedZones: ["RECLAIM"],
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
};
function updatedReaderFrom(input) {
  return { ...reader, name: input.name, version: 2 };
}

const readerService = {
  async listReadersForSite(_siteId, filters) {
    return {
      items: [reader],
      page: filters.page,
      pageSize: filters.pageSize,
      total: 1,
      totalPages: 1,
      dataLimitations: ["Reader health is derived from authoritative RFID activity."],
    };
  },
  async getReaderById() {
    return {
      ...reader,
      antennas: [],
      activity: {
        readsLastHour: 0,
        readsLast24Hours: 0,
        uniqueEpcsLast24Hours: 0,
        unassignedEpcsLast24Hours: 0,
        processingFailuresLast24Hours: 0,
      },
      healthBasis: "NO_AUTHORITATIVE_HEALTH_DATA",
    };
  },
  async updateReaderConfiguration(input) {
    return updatedReaderFrom(input);
  },
  async updateReader(input) {
    return updatedReaderFrom(input);
  },
  async createReaderConfiguration(input) {
    return {
      ...reader,
      readerCode: input.readerCode,
      name: input.name,
      zone: input.zone,
      vendor: input.vendor ?? null,
      model: input.model ?? null,
      adapterType: input.adapterType,
      host: input.host ?? null,
      enabled: input.enabled,
      configurationVersion: 1,
      version: 1,
    };
  },
  async setReaderEnabled(input) {
    return { ...reader, enabled: input.enabled, version: 2 };
  },
  async getReaderByCode() {
    return reader;
  },
  async updateAntenna() {
    throw new Error("not used");
  },
  async recordRejected() {},
};
const reportService = {
  async generate(reportType, filters, requestId) {
    return {
      requestId,
      reportType,
      filters,
      summary: { records: 0 },
      series: [],
      breakdowns: {},
      generatedAt: NOW,
      dataLimitations: ["No records in selected range."],
    };
  },
};
const auditItem = {
  id: "00000000-0000-4000-8000-000000000010",
  action: "BAG_RESOLVED",
  actorId: session.user.id,
  actorDisplayName: "System Administrator",
  actorRole: "System Administrator",
  targetType: "BAG",
  targetId: "1234567890",
  outcome: "SUCCESS",
  summary: "Bag resolved as CLEARED.",
  metadata: { disposition: "CLEARED" },
  requestId: "audit-1",
  createdAt: NOW,
};
const auditService = {
  async list(filters) {
    return {
      items: [auditItem],
      page: filters.page,
      pageSize: filters.pageSize,
      total: 1,
      totalPages: 1,
    };
  },
  async get() {
    return {
      ...auditItem,
      bagId: "1234567890",
      xrayScanId: null,
      integrationEventId: null,
      sourceSystem: "BELTCON",
      errorCode: null,
    };
  },
};

test("reader APIs require authentication and reader.view", async () => {
  const anonymous = await readerApi.handleListReadersRequest(
    new Request("http://localhost/api/readers"),
    { getSession: async () => null, service: readerService },
  );
  assert.equal(anonymous.status, 401);
  const forbidden = await readerApi.handleListReadersRequest(
    new Request("http://localhost/api/readers"),
    {
      getSession: async () => session,
      requirePermission: deny,
      service: readerService,
      recordAccessDenied: async () => {},
    },
  );
  assert.equal(forbidden.status, 403);
});

test("reader list validates pagination and server filters before invoking the service", async () => {
  const invalid = await readerApi.handleListReadersRequest(
    new Request("http://localhost/api/readers?page=0"),
    { getSession: async () => session, requirePermission: allow, service: readerService },
  );
  assert.equal(invalid.status, 400);
  const response = await readerApi.handleListReadersRequest(
    new Request("http://localhost/api/readers?page=1&pageSize=25&status=UNKNOWN&zone=RECLAIM"),
    { getSession: async () => session, requirePermission: allow, service: readerService },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items[0].readerCode, "RDR-001");
});

test("reader configuration mutation requires reader.manage and server actor identity", async () => {
  const request = new Request("http://localhost/api/readers/RDR-001", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      readerCode: "RDR-001",
      name: "Reader 1",
      zone: "RECLAIM",
      adapterType: "THINGMAGIC_IZAR",
      enabled: true,
      expectedVersion: 1,
    }),
  });
  const response = await readerApi.handleUpdateReaderRequest(request, "RDR-001", {
    getSession: async () => session,
    requirePermission: allow,
    service: readerService,
  });
  assert.equal(response.status, 200);
  const invalidPayload = await readerApi.handleUpdateReaderRequest(
    new Request("http://localhost/api/readers/RDR-001", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Reader 1", enabled: true, expectedVersion: 1 }),
    }),
    "RDR-001",
    { getSession: async () => session, requirePermission: allow, service: readerService },
  );
  assert.equal(invalidPayload.status, 400);
});

test("reader update service preserves registry fields and site scope", async () => {
  let capturedInput;
  const service = readerServiceModule.createReaderService(
    {
      updateReader: async (input) => {
        capturedInput = input;
        return { ...reader, ...input, siteId: input.siteId, version: 2 };
      },
    },
    { getSiteId: () => "SITE-A" },
  );

  await service.updateReader({
    readerId: "reader-uuid-1",
    readerCode: "RDR-009",
    name: "Reader 9",
    zone: "TAGGING",
    vendor: "ThingMagic",
    model: "IZAR",
    adapterType: "THINGMAGIC_IZAR",
    host: "10.42.7.99",
    enabled: true,
    expectedVersion: 1,
    actorId: session.user.id,
    canonicalRole: session.user.role,
    requestId: "reader-update-1",
  });

  assert.deepEqual(capturedInput, {
    readerId: "reader-uuid-1",
    readerCode: "RDR-009",
    siteId: "SITE-A",
    name: "Reader 9",
    zone: "TAGGING",
    vendor: "ThingMagic",
    model: "IZAR",
    adapterType: "THINGMAGIC_IZAR",
    host: "10.42.7.99",
    enabled: true,
    expectedVersion: 1,
    actorId: session.user.id,
    canonicalRole: session.user.role,
    requestId: "reader-update-1",
  });
});

test("reader registry create and enable mutations stay server-backed and reject duplicate codes", async () => {
  const created = await readerApi.handleCreateReaderRequest(
    new Request("http://localhost/api/readers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        readerCode: "RDR-009",
        name: "Reader 9",
        zone: "TAGGING",
        adapterType: "THINGMAGIC_IZAR",
        enabled: true,
      }),
    }),
    { getSession: async () => session, requirePermission: allow, service: readerService },
  );
  assert.equal(created.status, 201);
  assert.equal((await created.json()).reader.readerCode, "RDR-009");

  const enabled = await readerApi.handleSetReaderEnabledRequest(
    new Request("http://localhost/api/readers/RDR-001/enabled", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, expectedVersion: 1 }),
    }),
    "RDR-001",
    { getSession: async () => session, requirePermission: allow, service: readerService },
  );
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).reader.enabled, false);

  const duplicateService = {
    ...readerService,
    async createReaderConfiguration() {
      const error = new Error("duplicate key value violates unique constraint");
      error.code = "23505";
      throw error;
    },
  };
  const duplicate = await readerApi.handleCreateReaderRequest(
    new Request("http://localhost/api/readers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        readerCode: "RDR-001",
        name: "Reader 1 duplicate",
        zone: "TAGGING",
        adapterType: "THINGMAGIC_IZAR",
        enabled: true,
      }),
    }),
    { getSession: async () => session, requirePermission: allow, service: duplicateService },
  );
  assert.equal(duplicate.status, 409);
});

test("operational reports require report.view and reject excessive date ranges", async () => {
  const anonymous = await reportApi.handleOperationalReportRequest(
    new Request("http://localhost/api/reports/rfid"),
    "rfid",
    { getSession: async () => null, service: reportService },
  );
  assert.equal(anonymous.status, 401);
  const range = await reportApi.handleOperationalReportRequest(
    new Request("http://localhost/api/reports/rfid?dateFrom=2026-01-01&dateTo=2026-06-01"),
    "rfid",
    { getSession: async () => session, requirePermission: allow, service: reportService },
  );
  assert.equal(range.status, 400);
  assert.equal((await range.json()).code, "REPORT_RANGE_TOO_LARGE");
});

test("report and audit exports are authenticated server responses with CSV injection protection", async () => {
  const report = await reportApi.handleOperationalReportExportRequest(
    new Request("http://localhost/api/reports/rfid/export/csv"),
    "rfid",
    { getSession: async () => session, requirePermission: allow, service: reportService },
  );
  assert.equal(report.status, 200);
  assert.match(await report.text(), /Section/);
  const audit = await auditApi.handleExportAuditEventsRequest(
    new Request("http://localhost/api/audit/events/export/csv"),
    { getSession: async () => session, requirePermission: allow, service: auditService },
  );
  assert.equal(audit.status, 200);
  assert.match(await audit.text(), /BAG_RESOLVED/);
});

test("audit APIs require audit.view and return server-backed detail", async () => {
  const anonymous = await auditApi.handleListAuditEventsRequest(
    new Request("http://localhost/api/audit/events"),
    { getSession: async () => null, service: auditService },
  );
  assert.equal(anonymous.status, 401);
  const detail = await auditApi.handleGetAuditEventRequest(
    new Request("http://localhost/api/audit/events/00000000-0000-4000-8000-000000000010"),
    auditItem.id,
    { getSession: async () => session, requirePermission: allow, service: auditService },
  );
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).event.action, "BAG_RESOLVED");
});

test("Phase 9 architecture has no seed authority or browser writes for readers, reports, or audit", async () => {
  const files = await Promise.all(
    [
      "src/routes/readers.tsx",
      "src/routes/reports.tsx",
      "src/routes/audit.logs.tsx",
      "src/routes/settings.audit.tsx",
      "src/services/readers/readerClient.ts",
      "src/services/audit/auditClient.ts",
    ].map((file) => readFile(path.join(root, file), "utf8")),
  );
  for (const source of files) {
    assert.doesNotMatch(source, /@\/mocks\/seed/);
    assert.doesNotMatch(source, /@\/store\/appStore/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  }
  assert.match(files[0], /useReaders/);
  assert.match(files[1], /useOperationalReport/);
  assert.match(files[2], /AuditLogPanel/);
});

test("central query keys cover reader, report, and audit read models deterministically", () => {
  assert.deepEqual(
    queryKeys.readerKeys.list({ page: 1, zone: "RECLAIM" }),
    queryKeys.readerKeys.list({ zone: "RECLAIM", page: 1 }),
  );
  assert.deepEqual(
    queryKeys.reportKeys.rfid({ dateFrom: "2026-07-01" }),
    queryKeys.reportKeys.rfid({ dateFrom: "2026-07-01" }),
  );
  assert.deepEqual(queryKeys.auditKeys.detail("audit-1"), ["audit-events", "detail", "audit-1"]);
});

test("reader registry static contracts keep form payloads and list sorting aligned", async () => {
  const [readerRoute, readerRepository] = await Promise.all([
    readFile(path.join(root, "src/routes/readers.tsx"), "utf8"),
    readFile(path.join(root, "src/services/readers/readerRepository.server.ts"), "utf8"),
  ]);

  assert.match(readerRoute, /type ReaderFormInput = CreateReaderConfigurationInput/);
  assert.doesNotMatch(readerRoute, /expectedVersion:\s*1/);
  assert.match(readerRepository, /filters\.sort === "healthStatus"/);
  assert.match(readerRepository, /filters\.sort === "lastHeartbeatAt"/);
  assert.doesNotMatch(readerRepository, /filters\.sort === "health"/);
  assert.doesNotMatch(readerRepository, /filters\.sort === "lastSeenAt"/);
});

test("migration 022 is additive, guarded, audited, and does not implement device control or a warehouse", async () => {
  const migration = await readFile(
    path.join(root, "supabase/migrations/022_create_beltcon_reader_report_audit_read_models.sql"),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS enabled/);
  assert.match(migration, /version INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /update_beltcon_reader_configuration_v1/);
  assert.match(migration, /update_beltcon_reader_antenna_configuration_v1/);
  assert.match(migration, /READER_CONFIGURATION_UPDATED/);
  assert.match(migration, /ANTENNA_ZONE_MAPPING_CHANGED/);
  assert.match(migration, /DROP POLICY IF EXISTS "auth_read_readers"/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.reader_antennas FROM anon, authenticated/);
  assert.match(migration, /TO service_role/);
  assert.doesNotMatch(
    migration,
    /DROP TABLE|CREATE MATERIALIZED VIEW|CREATE TABLE public\.report/i,
  );
});
