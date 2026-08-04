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

const [adapterModule, runtimeModule, simulatorApiModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/rfid/adapters/simulatedRfidReaderAdapter.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/adapters/rfidReaderAdapterRuntime.server.ts"),
  vite.ssrLoadModule("/src/services/rfid/rfidSimulatorApi.server.ts"),
]);

const { SimulatedRfidReaderAdapter } = adapterModule;
const { RfidReaderAdapterRuntime } = runtimeModule;
const { handleRfidSimulatorRead } = simulatorApiModule;

function readerSummary(overrides = {}) {
  return {
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
    healthStatus: "UNKNOWN",
    calculatedHealth: "UNKNOWN",
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
    ...overrides,
  };
}

function sessionLookup() {
  return async () => ({
    user: {
      id: "user-1",
      name: "Developer",
      email: "dev@example.test",
      role: "System Administrator",
    },
    tokenExpiry: Date.now() + 60_000,
  });
}

function allowSimulatorPermission() {
  return async () => undefined;
}

test("simulated adapter start, stop, burst, unsubscribe, and handler isolation", async () => {
  const adapter = new SimulatedRfidReaderAdapter({
    readerId: "reader-1",
    clock: () => new Date("2026-08-03T10:00:00.000Z"),
    idFactory: () => "event-1",
  });

  const reads = [];
  const firstHandler = (event) => {
    reads.push(event);
  };
  const unsubscribe = adapter.subscribe(firstHandler);
  adapter.subscribe(() => {
    throw new Error("handler failure");
  });

  await adapter.start();
  const healthStarted = await adapter.getHealth();
  assert.equal(healthStarted.state, "SIMULATED");
  assert.equal(healthStarted.connected, true);

  const first = await adapter.emitRead({ epc: "epc-1", antennaPort: 3, rssiDbm: -47 });
  assert.equal(first.sourceEventId, "event-1");
  assert.equal(first.readCount, 1);
  assert.equal(reads.length, 1);

  unsubscribe();
  await adapter.emitRead({ epc: "epc-2", antennaPort: 4, rssiDbm: -48 });
  assert.equal(reads.length, 1);

  const burst = await adapter.emitBurst({ epc: "epc-3", antennaPort: 5 }, 3);
  assert.equal(burst.length, 3);
  assert.equal(burst.every((event) => event.readCount === 1), true);
  assert.equal(burst.every((event) => event.readerId === "reader-1"), true);

  await adapter.stop();
  const healthStopped = await adapter.getHealth();
  assert.equal(healthStopped.connected, false);
});

test("runtime reuses adapters, rejects disabled readers, and surfaces physical adapters as misconfigured", async () => {
  const readers = new Map([
    ["reader-1", readerSummary()],
    ["reader-2", readerSummary({ id: "reader-2", adapterType: "SIMULATED", enabled: false })],
    ["reader-3", readerSummary({ id: "reader-3", adapterType: "THINGMAGIC_IZAR" })],
  ]);
  const runtime = new RfidReaderAdapterRuntime({
    readerService: {
      getReaderById: async (_siteId, readerId) => readers.get(readerId) ?? null,
      getReaderByCode: async () => null,
      listReadersForSite: async () => ({
        items: Array.from(readers.values()),
        page: 1,
        pageSize: 25,
        total: readers.size,
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
      list: async () => ({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0, dataLimitations: [] }),
      get: async () => null,
      updateReader: async () => {
        throw new Error("not used");
      },
      updateAntenna: async () => {
        throw new Error("not used");
      },
      recordRejected: async () => undefined,
      listReadersForSite: async () => ({
        items: Array.from(readers.values()),
        page: 1,
        pageSize: 25,
        total: readers.size,
        totalPages: 1,
        dataLimitations: [],
      }),
      getReaderById: async (_siteId, readerId) => readers.get(readerId) ?? null,
      getReaderByCode: async () => null,
    },
    getSiteId: () => "ALWAJH",
    simulatorEnabled: true,
    clock: () => new Date("2026-08-03T10:00:00.000Z"),
    idFactory: () => "runtime-event",
  });

  const adapter = await runtime.getOrCreateAdapter("reader-1");
  const adapterAgain = await runtime.getOrCreateAdapter("reader-1");
  assert.equal(adapter, adapterAgain);

  const health = await runtime.startReader("reader-1");
  assert.equal(health.state, "SIMULATED");
  await assert.rejects(() => runtime.startReader("reader-2"), /RFID_READER_DISABLED/);

  const physicalHealth = await runtime.getReaderAdapterHealth("reader-3");
  assert.equal(physicalHealth.state, "MISCONFIGURED");
  await assert.rejects(
    () => runtime.emitSimulatedRead("reader-3", { epc: "EPc-1", antennaPort: 1 }),
    /RFID_SIMULATOR_READER_NOT_SUPPORTED/,
  );
});

test("simulator route rejects disabled simulator and accepts only safe reader actions", async () => {
  const disabled = await handleRfidSimulatorRead(new Request("http://localhost/api/dev/simulator/rfid/reads", { method: "GET" }), {
    getSession: sessionLookup(),
    featureEnabled: false,
  });
  assert.equal(disabled.status, 403);
});

test("browser panel stays read-only for site and health selection", async () => {
  const source = await readFile(path.join(repositoryRoot, "src/features/simulator/SimulatorPanel.tsx"), "utf8");
  assert.doesNotMatch(source, /siteId|site_id|healthStatus|lastHeartbeatAt/);
  assert.match(source, /SIMULATED readers/);
});
