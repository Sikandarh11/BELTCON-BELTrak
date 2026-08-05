import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: {
    alias: {
      "@": `${repositoryRoot}/src`,
    },
  },
});

test.after(async () => {
  await vite.close();
});

const [serviceModule, runtimeModule, apiModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/rfid/detections/rfidDetectionService.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/adapters/rfidReaderAdapterRuntime.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/rfidSimulatorApi.server.ts"),
]);

const { createRfidDetectionService, rfidDetectionService } = serviceModule;
const { RfidReaderAdapterRuntime } = runtimeModule;
const { handleRfidSimulatorRead } = apiModule;

const reader = {
  id: "reader-1",
  readerCode: "RFID-01",
  siteId: "ALWAJH",
  name: "Simulator Reader",
  zone: "TAGGING",
  model: null,
  vendor: null,
  adapterType: "SIMULATED",
  host: null,
  enabled: true,
  healthStatus: "SIMULATED",
  calculatedHealth: "SIMULATED",
  lastHeartbeatAt: null,
  lastEventAt: null,
  configurationVersion: 1,
  createdAt: null,
  updatedAt: null,
  createdBy: null,
  updatedBy: null,
  firmwareVersion: null,
  configuredStatus: null,
  lastSeenAt: null,
  lastReadAt: null,
  antennaCount: 0,
  activeAntennaCount: 0,
  mappedZones: ["TAGGING"],
  version: 1,
};

function readerService(overrides = {}) {
  return {
    getReaderById: async (_siteId, readerId) =>
      readerId === reader.id ? { ...reader, ...overrides } : null,
    getReaderByIdAcrossSites: async (readerId) =>
      readerId === reader.id ? { ...reader, siteId: "OTHER_SITE", ...overrides } : null,
    getReaderByCode: async () => null,
    listReadersForSite: async () => ({
      items: [reader],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      dataLimitations: [],
    }),
    createReaderConfiguration: async () => {
      throw new Error("not used");
    },
    updateReaderConfiguration: async () => {
      throw new Error("not used");
    },
    setReaderEnabled: async () => {
      throw new Error("not used");
    },
    list: async () => ({
      items: [reader],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      dataLimitations: [],
    }),
    get: async () => null,
    updateReader: async () => {
      throw new Error("not used");
    },
    updateAntenna: async () => {
      throw new Error("not used");
    },
    recordRejected: async () => undefined,
  };
}

test("detection service validates read-point resolution before atomic processing", async () => {
  const event = {
    id: "11111111-1111-4111-8111-111111111111",
    siteId: "ALWAJH",
    readerId: reader.id,
    sourceEventId: "source-1",
    epc: "00AA00AA00AA00AA00AA00AA",
    antennaPort: 3,
    rssiDbm: -42,
    firstSeenAt: "2026-08-04T10:00:00.000Z",
    lastSeenAt: "2026-08-04T10:00:00.000Z",
    readCount: 1,
    adapterType: "SIMULATED",
    simulated: true,
    receivedAt: "2026-08-04T10:00:01.000Z",
    payloadHash: "a".repeat(64),
    createdAt: "2026-08-04T10:00:01.000Z",
  };

  const repository = {
    getById: async () => event,
    ingestReadAtomically: async () => {
      throw new Error("not used");
    },
    getBySourceEvent: async () => null,
  };

  await assert.rejects(
    () =>
      createRfidDetectionService({
        readerService: readerService(),
        eventRepository: repository,
        detectionRepository: {
          processStoredRfidEventAtomically: async () => {
            throw new Error("not used");
          },
        },
        loadReadPoint: async () => null,
      }).processStoredRfidEvent({ rfidEventId: event.id }),
    (error) => error instanceof Error && /RFID_ANTENNA_MAPPING_MISSING/.test(error.message),
  );

  await assert.rejects(
    () =>
      createRfidDetectionService({
        readerService: readerService({ enabled: true }),
        eventRepository: repository,
        detectionRepository: {
          processStoredRfidEventAtomically: async () => {
            throw new Error("not used");
          },
        },
        loadReadPoint: async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          siteId: "ALWAJH",
          readerId: reader.id,
          antennaPort: 3,
          code: "TAGGING-1",
          name: "Tagging Point",
          zone: "TAGGING",
          enabled: false,
          dedupWindowMs: 1000,
          lateArrivalToleranceMs: 5000,
          includeAntennaInKey: true,
          createdAt: "2026-08-04T10:00:00.000Z",
          updatedAt: "2026-08-04T10:00:00.000Z",
        }),
      }).processStoredRfidEvent({ rfidEventId: event.id }),
    (error) => error instanceof Error && /RFID_READ_POINT_DISABLED/.test(error.message),
  );
});

test("simulator runtime returns combined ingestion and detection payload", async () => {
  const ingestion = {
    outcome: "STORED",
    eventId: "33333333-3333-4333-8333-333333333333",
    sourceEventId: "source-1",
    readerId: reader.id,
    siteId: reader.siteId,
    epc: "00AA00AA00AA00AA00AA00AA",
    receivedAt: "2026-08-04T10:00:01.000Z",
    simulated: true,
  };
  const detection = {
    outcome: "EPISODE_CREATED",
    detectionId: "44444444-4444-4444-8444-444444444444",
    readPointId: "55555555-5555-4555-8555-555555555555",
    readPointCode: "TAGGING-1",
    readPointName: "Tagging Point",
    readPointZone: "TAGGING",
    readerId: reader.id,
    epc: "00AA00AA00AA00AA00AA00AA",
    antennaPort: 3,
    firstDetectedAt: "2026-08-04T10:00:00.000Z",
    lastDetectedAt: "2026-08-04T10:00:00.000Z",
    rawEventCount: 1,
    totalReadCount: 1,
    strongestRssiDbm: -42,
    weakestRssiDbm: -42,
    latestRssiDbm: -42,
    simulated: true,
  };
  const runtime = new RfidReaderAdapterRuntime({
    readerService: readerService(),
    ingestionService: {
      ingestTrustedRead: async () => ingestion,
      getBySourceEvent: async () => ingestion,
    },
    detectionService: {
      processStoredRfidEvent: async () => detection,
    },
    simulatorEnabled: true,
    clock: () => new Date("2026-08-04T10:00:00.000Z"),
    idFactory: () => "ignored",
  });

  await runtime.startReader(reader.id);
  const response = await handleRfidSimulatorRead(
    new Request("http://localhost/api/dev/simulator/rfid/reads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "emit",
        readerId: reader.id,
        epc: "00aa00aa00aa00aa00aa00aa",
        antennaPort: 3,
        rssiDbm: -42,
      }),
    }),
    {
      getSession: async () => ({
        user: {
          id: "user-1",
          name: "Developer",
          email: "dev@example.test",
          role: "System Administrator",
        },
        tokenExpiry: Date.now() + 60_000,
      }),
      requirePermission: async () => undefined,
      runtime,
      featureEnabled: true,
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.readerId, reader.id);
  assert.equal(body.result.ingestion.outcome, "STORED");
  assert.equal(body.result.detection.outcome, "EPISODE_CREATED");
  assert.equal(body.result.detection.readPointCode, "TAGGING-1");
});
