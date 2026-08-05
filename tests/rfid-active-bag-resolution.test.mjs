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

const [serviceModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/rfid/detections/rfidDetectionService.server.ts"),
]);

const { createRfidDetectionService } = serviceModule;

test("detection service resolves the active bag after baseline detection", async () => {
  let resolutionCalls = 0;
  const service = createRfidDetectionService({
    eventRepository: {
      getById: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        siteId: "ALWAJH",
        readerId: "reader-1",
        epc: "00AA00AA00AA00AA00AA00AA",
        firstSeenAt: "2026-08-04T10:00:00.000Z",
        lastSeenAt: "2026-08-04T10:00:00.000Z",
        rssiDbm: -42,
        simulated: true,
        createdAt: "2026-08-04T10:00:00.000Z",
      }),
    },
    detectionRepository: {
      processStoredRfidEventAtomically: async () => ({
        outcome: "DETECTION_CREATED",
        detectionId: "22222222-2222-4222-8222-222222222222",
        rfidEventId: "11111111-1111-4111-8111-111111111111",
        readerId: "reader-1",
        zone: "TAGGING",
        epc: "00AA00AA00AA00AA00AA00AA",
        firstDetectedAt: "2026-08-04T10:00:00.000Z",
        lastDetectedAt: "2026-08-04T10:00:00.000Z",
        rawEventCount: 1,
        totalReadCount: 1,
        strongestRssiDbm: -42,
        simulated: true,
        version: 1,
        createdAt: "2026-08-04T10:00:00.000Z",
        updatedAt: "2026-08-04T10:00:00.000Z",
      }),
    },
    resolutionService: {
      resolveActiveBagForDetection: async (detectionId) => {
        resolutionCalls += 1;
        assert.equal(detectionId, "22222222-2222-4222-8222-222222222222");
        return {
          outcome: "ACTIVE_SUSPECT_BAG",
          detectionId,
          epc: "00AA00AA00AA00AA00AA00AA",
          tagAssignmentId: "33333333-3333-4333-8333-333333333333",
          bagId: "ETB-1",
          assignmentStatus: "ACTIVE",
          bagStatus: "TAGGED",
          alarmEligible: true,
        };
      },
    },
    readerService: {
      getReaderById: async () => ({
        id: "reader-1",
        siteId: "ALWAJH",
        enabled: true,
        zone: "TAGGING",
      }),
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

  const result = await service.processStoredRfidEvent({
    rfidEventId: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(result.outcome, "DETECTION_CREATED");
  assert.equal(resolutionCalls, 1);
});
