import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

const [serviceModule, runtimeModule, apiModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/rfid/events/rfidReadEventService.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/adapters/rfidReaderAdapterRuntime.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/rfidSimulatorApi.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/events/rfidReadEventErrors.ts"),
]);

const { createRfidReadEventService } = serviceModule;
const { RfidReaderAdapterRuntime } = runtimeModule;
const { handleRfidSimulatorRead } = apiModule;
const { RfidReadError } = await vite.ssrLoadModule("/src/services/rfid/events/rfidReadEventErrors.ts");

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

test("authoritative RFID reads are validated and canonicalized before persistence", async () => {
  const calls = [];
  const repository = {
    ingestReadAtomically: async (input) => {
      calls.push(input);
      return {
        outcome: "STORED",
        eventId: "11111111-1111-4111-8111-111111111111",
        sourceEventId: input.sourceEventId,
        readerId: input.readerId,
        siteId: input.siteId,
        epc: input.epc,
        receivedAt: input.receivedAt,
        simulated: input.simulated,
      };
    },
    getBySourceEvent: async () => null,
  };
  const service = createRfidReadEventService(repository, {
    readerService: readerService(),
    clock: () => new Date("2026-08-04T10:00:00.000Z"),
  });

  const epc = "00aa00aa00aa00aa00aa00aa";
  const result = await service.ingestTrustedRead({
    trustedSiteId: "ALWAJH",
    receivedAt: "2026-08-04T10:00:01.000Z",
    rawRead: {
      sourceEventId: "source-1",
      readerId: reader.id,
      epc,
      antennaPort: 3,
      rssiDbm: -42,
      firstSeenAt: "2026-08-04T10:00:00.000Z",
      lastSeenAt: "2026-08-04T10:00:00.000Z",
      readCount: 1,
      adapterType: "SIMULATED",
      simulated: true,
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].epc, epc.toUpperCase());
  assert.equal(calls[0].payloadHash.length, 64);
  assert.equal(result.epc, epc.toUpperCase());
  assert.equal(result.outcome, "STORED");
});

test("invalid EPCs and timestamp order are rejected before repository mutation", async () => {
  let calls = 0;
  const repository = {
    ingestReadAtomically: async () => {
      calls += 1;
      throw new Error("should not be reached");
    },
    getBySourceEvent: async () => null,
  };
  const service = createRfidReadEventService(repository, {
    readerService: readerService(),
    clock: () => new Date("2026-08-04T10:00:00.000Z"),
  });

  await assert.rejects(
    () =>
      service.ingestTrustedRead({
        trustedSiteId: "ALWAJH",
        rawRead: {
          sourceEventId: "source-1",
          readerId: reader.id,
          epc: "not-hex",
          antennaPort: 1,
          rssiDbm: -42,
          firstSeenAt: "2026-08-04T10:00:00.000Z",
          lastSeenAt: "2026-08-04T10:00:00.000Z",
          readCount: 1,
          adapterType: "SIMULATED",
          simulated: true,
        },
      }),
    (error) => error instanceof RfidReadError && error.code === "RFID_READ_INVALID",
  );

  await assert.rejects(
    () =>
      service.ingestTrustedRead({
        trustedSiteId: "ALWAJH",
        rawRead: {
          sourceEventId: "source-2",
          readerId: reader.id,
          epc: "00AA00AA00AA00AA00AA00AA",
          antennaPort: 1,
          rssiDbm: -42,
          firstSeenAt: "2026-08-04T10:00:01.000Z",
          lastSeenAt: "2026-08-04T10:00:00.000Z",
          readCount: 1,
          adapterType: "SIMULATED",
          simulated: true,
        },
      }),
    (error) => error instanceof RfidReadError && error.code === "RFID_READ_INVALID",
  );

  assert.equal(calls, 0);
});

test("unknown, disabled, cross-site, and adapter-mismatched readers are rejected", async () => {
  const commonRead = {
    sourceEventId: "source-1",
    epc: "00AA00AA00AA00AA00AA00AA",
    antennaPort: 1,
    rssiDbm: -42,
    firstSeenAt: "2026-08-04T10:00:00.000Z",
    lastSeenAt: "2026-08-04T10:00:00.000Z",
    readCount: 1,
    simulated: true,
  };

  const unknownService = createRfidReadEventService(
    { ingestReadAtomically: async () => ({}) , getBySourceEvent: async () => null },
    { readerService: readerService({ enabled: true }) },
  );
  await assert.rejects(
    () =>
      unknownService.ingestTrustedRead({
        trustedSiteId: "ALWAJH",
        rawRead: { ...commonRead, readerId: "missing-reader", adapterType: "SIMULATED" },
      }),
    (error) => error instanceof RfidReadError && error.code === "RFID_READER_NOT_FOUND",
  );

  const disabledService = createRfidReadEventService(
    { ingestReadAtomically: async () => ({}) , getBySourceEvent: async () => null },
    { readerService: readerService({ enabled: false }) },
  );
  await assert.rejects(
    () =>
      disabledService.ingestTrustedRead({
        trustedSiteId: "ALWAJH",
        rawRead: { ...commonRead, readerId: reader.id, adapterType: "SIMULATED" },
      }),
    (error) => error instanceof RfidReadError && error.code === "RFID_READER_DISABLED",
  );

  const crossSiteService = createRfidReadEventService(
    { ingestReadAtomically: async () => ({}) , getBySourceEvent: async () => null },
    {
      readerService: {
        ...readerService(),
        getReaderById: async () => null,
        getReaderByIdAcrossSites: async () => ({ ...reader, siteId: "DIFFERENT" }),
      },
    },
  );
  await assert.rejects(
    () =>
      crossSiteService.ingestTrustedRead({
        trustedSiteId: "ALWAJH",
        rawRead: { ...commonRead, readerId: reader.id, adapterType: "SIMULATED" },
      }),
    (error) => error instanceof RfidReadError && error.code === "RFID_READER_SITE_MISMATCH",
  );

  const mismatchService = createRfidReadEventService(
    { ingestReadAtomically: async () => ({}) , getBySourceEvent: async () => null },
    { readerService: readerService({ adapterType: "THINGMAGIC_IZAR" }) },
  );
  await assert.rejects(
    () =>
      mismatchService.ingestTrustedRead({
        trustedSiteId: "ALWAJH",
        rawRead: { ...commonRead, readerId: reader.id, adapterType: "SIMULATED" },
      }),
    (error) => error instanceof RfidReadError && error.code === "RFID_ADAPTER_TYPE_MISMATCH",
  );
});

test("runtime converges on a durable stored result and replays exact retries", async () => {
  const stored = {
    outcome: "STORED",
    eventId: "22222222-2222-4222-8222-222222222222",
    sourceEventId: "source-1",
    readerId: reader.id,
    siteId: reader.siteId,
    epc: "00AA00AA00AA00AA00AA00AA",
    receivedAt: "2026-08-04T10:00:01.000Z",
    simulated: true,
  };
  const calls = [];
  const ingestionService = {
    ingestTrustedRead: async (input) => {
      calls.push(input);
      return calls.length === 1
        ? stored
        : { ...stored, outcome: "DUPLICATE_REPLAY" };
    },
    getBySourceEvent: async () => stored,
  };
  const runtime = new RfidReaderAdapterRuntime({
    readerService: readerService(),
    ingestionService,
    simulatorEnabled: true,
    clock: () => new Date("2026-08-04T10:00:00.000Z"),
    idFactory: () => "ignored",
  });

  await runtime.startReader(reader.id);
  const first = await runtime.emitSimulatedRead(reader.id, {
    sourceEventId: "source-1",
    epc: "00aa00aa00aa00aa00aa00aa",
    antennaPort: 1,
    rssiDbm: -42,
  });
  const second = await runtime.emitSimulatedRead(reader.id, {
    sourceEventId: "source-1",
    epc: "00aa00aa00aa00aa00aa00aa",
    antennaPort: 1,
    rssiDbm: -42,
  });

  assert.equal(calls.length, 2);
  assert.equal(first[0].outcome, "STORED");
  assert.equal(second[0].outcome, "DUPLICATE_REPLAY");
  assert.equal(first[0].epc, "00AA00AA00AA00AA00AA00AA");
});

test("runtime surfaces transport conflicts and the simulator route remains production-disabled", async () => {
  const runtime = new RfidReaderAdapterRuntime({
    readerService: readerService(),
    ingestionService: {
      ingestTrustedRead: async () => {
        throw new RfidReadError("RFID_SOURCE_EVENT_CONFLICT", "RFID source event conflict", 409);
      },
      getBySourceEvent: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        siteId: reader.siteId,
        readerId: reader.id,
        sourceEventId: "source-1",
        epc: "00AA00AA00AA00AA00AA00AA",
        antennaPort: 1,
        rssiDbm: -42,
        firstSeenAt: "2026-08-04T10:00:00.000Z",
        lastSeenAt: "2026-08-04T10:00:00.000Z",
        readCount: 1,
        adapterType: "SIMULATED",
        simulated: true,
        receivedAt: "2026-08-04T10:00:01.000Z",
        payloadHash: "a".repeat(64),
        createdAt: "2026-08-04T10:00:01.000Z",
      }),
    },
    simulatorEnabled: true,
    clock: () => new Date("2026-08-04T10:00:00.000Z"),
  });

  await runtime.startReader(reader.id);
  await assert.rejects(
    () =>
      runtime.emitSimulatedRead(reader.id, {
        sourceEventId: "source-1",
        epc: "00aa00aa00aa00aa00aa00aa",
        antennaPort: 1,
      }),
    (error) => error instanceof RfidReadError && error.code === "RFID_SOURCE_EVENT_CONFLICT",
  );

  const disabled = await handleRfidSimulatorRead(
    new Request("http://localhost/api/dev/simulator/rfid/reads", { method: "GET" }),
    {
      getSession: async () => ({
        user: { id: "user-1", name: "Developer", email: "dev@example.test", role: "System Administrator" },
        tokenExpiry: Date.now() + 60_000,
      }),
      requirePermission: async () => undefined,
      featureEnabled: false,
    },
  );
  assert.equal(disabled.status, 403);
  const body = await disabled.json();
  assert.equal(body.code, "RFID_SIMULATOR_DISABLED");

  const panelSource = await readFile(path.join(repositoryRoot, "src/features/simulator/SimulatorPanel.tsx"), "utf8");
  assert.match(panelSource, /Software simulator/);
  assert.match(panelSource, /No physical RFID hardware connected/);
  assert.doesNotMatch(panelSource, /form\.register\("siteId"\)|site_id/);
});
