import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": `${repositoryRoot}/src` } },
});

test.after(async () => {
  await vite.close();
});

const [serviceModule, apiModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/rfid/detections/rfidDetectionService.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/rfidSimulatorApi.server.ts"),
]);

const { createRfidDetectionService } = serviceModule;
const { handleRfidSimulatorRead } = apiModule;

const reader = {
  id: "reader-1",
  readerCode: "RFID-01",
  siteId: "ALWAJH",
  name: "Reader",
  zone: "TAGGING",
  adapterType: "SIMULATED",
  enabled: true,
};

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  siteId: "ALWAJH",
  readerId: reader.id,
  epc: "00AA00AA00AA00AA00AA00AA",
  firstSeenAt: "2026-08-04T10:00:00.000Z",
  lastSeenAt: "2026-08-04T10:00:00.000Z",
  rssiDbm: -42,
  simulated: true,
  createdAt: "2026-08-04T10:00:01.000Z",
};

test("baseline service processes tagged zones and ignores optional zones", async () => {
  const repo = {
    getById: async () => event,
    getBySourceEvent: async () => null,
    ingestReadAtomically: async () => null,
  };
  const detectionRepo = {
    processStoredRfidEventAtomically: async () => ({
      outcome: "DETECTION_CREATED",
      detectionId: event.id,
      rfidEventId: event.id,
      readerId: reader.id,
      zone: "TAGGING",
      epc: event.epc,
      firstDetectedAt: event.firstSeenAt,
      lastDetectedAt: event.lastSeenAt,
      rawEventCount: 1,
      totalReadCount: 1,
      strongestRssiDbm: event.rssiDbm,
      simulated: true,
      version: 1,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    }),
  };

  const service = createRfidDetectionService({
    eventRepository: repo,
    detectionRepository: detectionRepo,
    readerService: {
      getReaderById: async () => reader,
      getReaderByIdAcrossSites: async () => null,
      getReaderByCode: async () => null,
      listReadersForSite: async () => ({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0, dataLimitations: [] }),
      createReaderConfiguration: async () => null,
      updateReaderConfiguration: async () => null,
      setReaderEnabled: async () => null,
      list: async () => ({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0, dataLimitations: [] }),
      get: async () => null,
      updateReader: async () => null,
      updateAntenna: async () => null,
      recordRejected: async () => undefined,
    },
  });

  const result = await service.processStoredRfidEvent({ rfidEventId: event.id });
  assert.equal(result.outcome, "DETECTION_CREATED");
});

test("simulator rejects browser-supplied zone and windowMs", async () => {
  const response = await handleRfidSimulatorRead(
    new Request("http://localhost/api/dev/simulator/rfid/reads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "emit",
        readerId: "reader-1",
        epc: "00aa00aa00aa00aa00aa00aa",
        antennaPort: 1,
        zone: "CUSTOMS_EXIT",
        windowMs: 5000,
      }),
    }),
    {
      getSession: async () => ({
        user: { id: "user-1", name: "Developer", email: "dev@example.test", role: "System Administrator" },
        tokenExpiry: Date.now() + 60_000,
      }),
      requirePermission: async () => undefined,
      featureEnabled: true,
      runtime: {
        listConfiguredReaders: async () => [],
        getOrCreateAdapter: async () => ({}),
        startReader: async () => ({}),
        stopReader: async () => ({}),
        getReaderAdapterHealth: async () => ({}),
        emitSimulatedRead: async () => [],
        getProcessingOutcome: async () => null,
        reset: async () => undefined,
      },
    },
  );
  assert.equal(response.status, 400);
});
