import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const [modelModule, apiModule, repositoryModule] = await Promise.all([
  vite.ssrLoadModule("/src/types/rfid.ts"),
  vite.ssrLoadModule("/src/services/bags/rfidTrackableApi.server.ts"),
  vite.ssrLoadModule("/src/services/bags/rfidTrackableRepository.server.ts"),
]);

const { isRfidTrackableBag, matchesRfidBagSearch, RFID_MOVEMENT_STATUSES } = modelModule;
const { handleRfidTrackableBagsRequest } = apiModule;
const { mapRfidTrackableBag } = repositoryModule;

function createBag(overrides = {}) {
  return {
    id: "ETB-DYNAMIC-001",
    sourceSystem: "SIMULATED_HBSS",
    bhsUid: "BHS-DYNAMIC-001",
    iataCode: "0123456789",
    iataOrigin: "RUH",
    epc: "EPC-DYNAMIC-001",
    flightNo: "SV101",
    passengerName: "Simulator Passenger",
    threatType: "ORGANIC_DENSITY",
    threatLevel: 3,
    screeningStation: "HBSS-SIM-01",
    screenedAt: "2026-07-26T10:00:00.000Z",
    status: "TAGGED",
    flaggedAt: "2026-07-26T10:00:00.000Z",
    taggedAt: "2026-07-26T10:05:00.000Z",
    lastSeenZone: "TAGGING_STATION",
    updatedAt: "2026-07-26T10:05:00.000Z",
    ...overrides,
  };
}

function sessionLookupFor(role = "Operations Officer", userId = "officer-1") {
  return async () => ({
    user: {
      id: userId,
      name: "RFID Tester",
      email: `${userId}@example.test`,
      role,
    },
    tokenExpiry: Date.now() + 60_000,
  });
}

test("RFID movement model includes TAGGED and IN_TRANSIT only", () => {
  assert.deepEqual([...RFID_MOVEMENT_STATUSES], ["TAGGED", "IN_TRANSIT"]);
  assert.equal(isRfidTrackableBag(createBag()), true);
  assert.equal(isRfidTrackableBag(createBag({ status: "IN_TRANSIT" })), true);
  assert.equal(isRfidTrackableBag(createBag({ epc: "" })), false);
  assert.equal(isRfidTrackableBag(createBag({ epc: "   " })), false);
  assert.equal(isRfidTrackableBag(createBag({ status: "RESOLVED" })), false);
  assert.equal(isRfidTrackableBag(createBag({ status: "ALARMED" })), false);
});

test("RFID bag search matches Bag ID, BHS UID, and EPC", () => {
  const bag = createBag();
  assert.equal(matchesRfidBagSearch(bag, "dynamic-001"), true);
  assert.equal(matchesRfidBagSearch(bag, "bhs-dynamic"), true);
  assert.equal(matchesRfidBagSearch(bag, "epc-dynamic"), true);
  assert.equal(matchesRfidBagSearch(bag, "missing-value"), false);
});

test("repository mapping preserves server fields and maps database transit status", () => {
  const bag = mapRfidTrackableBag({
    id: "ETB-DB-001",
    source_system: "SIMULATED_HBSS",
    bhs_uid: "BHS-DB-001",
    iata_code: "0123456789",
    iata_origin: "RUH",
    epc: "EPC-DB-001",
    flight: "SV202",
    passenger_name: "Database Passenger",
    threat_type: "METALLIC_MASS",
    threat_level: 4,
    screening_station: "HBSS-SIM-02",
    screened_at: "2026-07-26T11:00:00.000Z",
    status: "IN_ARRIVAL_HALL",
    current_zone: "ARRIVAL_HALL",
    flagged_at: "2026-07-26T10:50:00.000Z",
    tagged_at: "2026-07-26T10:55:00.000Z",
    notes: null,
    created_at: "2026-07-26T10:50:00.000Z",
    updated_at: "2026-07-26T11:00:00.000Z",
  });

  assert.equal(bag.status, "IN_TRANSIT");
  assert.equal(bag.bhsUid, "BHS-DB-001");
  assert.equal(bag.epc, "EPC-DB-001");
  assert.equal(bag.lastSeenZone, "ARRIVAL_HALL");
  assert.equal(bag.flightNo, "SV202");
});

test("newly tagged database bag is returned to independent authenticated sessions", async () => {
  const dynamicBag = createBag();
  const seedBag = createBag({
    id: "ETB-240072",
    bhsUid: "BHS-SEED-072",
    epc: "EPC-SEED-072",
  });
  const loadBags = async () => [dynamicBag, seedBag];

  const firstResponse = await handleRfidTrackableBagsRequest(
    new Request("http://localhost/api/bags/rfid-trackable"),
    {
      getSession: sessionLookupFor("Operations Officer", "browser-a"),
      loadBags,
    },
  );
  const secondResponse = await handleRfidTrackableBagsRequest(
    new Request("http://localhost/api/bags/rfid-trackable"),
    {
      getSession: sessionLookupFor("Operations Officer", "browser-b"),
      loadBags,
    },
  );

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(
    (await firstResponse.json()).bags.map((bag) => bag.id),
    ["ETB-DYNAMIC-001", "ETB-240072"],
  );
  assert.equal((await secondResponse.json()).bags[0].id, "ETB-DYNAMIC-001");
});

test("RFID-trackable query requires a canonical Operations Officer or higher", async () => {
  const unauthenticated = await handleRfidTrackableBagsRequest(
    new Request("http://localhost/api/bags/rfid-trackable"),
    { getSession: async () => null, loadBags: async () => [] },
  );
  const unknownRole = await handleRfidTrackableBagsRequest(
    new Request("http://localhost/api/bags/rfid-trackable"),
    { getSession: sessionLookupFor("Visitor"), loadBags: async () => [] },
  );

  assert.equal(unauthenticated.status, 401);
  assert.equal(unknownRole.status, 403);
});

test("simulator and Tagging wire authoritative server queries and refresh triggers", () => {
  const simulatorSource = readFileSync(
    path.join(repositoryRoot, "src/features/simulator/SimulatorPanel.tsx"),
    "utf8",
  );
  const taggingSource = readFileSync(path.join(repositoryRoot, "src/routes/tagging.tsx"), "utf8");

  assert.match(simulatorSource, /useRfidTrackableBags\(\)/);
  assert.match(simulatorSource, /useReaderAntennaMap\(\)/);
  assert.match(simulatorSource, /useSubmitSimulatedRfidRead\(\)/);
  assert.doesNotMatch(
    simulatorSource,
    /const activeBags = bags\.filter\(\(bag\) => bag\.status === "TAGGED"/,
  );
  assert.match(simulatorSource, /Refresh data/);
  assert.doesNotMatch(simulatorSource, /useAppStore|eventService|bagService|alarmService/);
  assert.match(taggingSource, /RFID_TRACKABLE_BAGS_QUERY_KEY[\s\S]*?refetchType: "all"/);
});

test("browser legacy lifecycle authority is removed while the server RFID pipeline remains authoritative", () => {
  const serviceSource = readFileSync(
    path.join(repositoryRoot, "src/services/bagService.ts"),
    "utf8",
  );
  const storeSource = readFileSync(path.join(repositoryRoot, "src/store/appStore.ts"), "utf8");

  assert.doesNotMatch(serviceSource, /useAppStore|registerRead\(bagId/);
  assert.match(serviceSource, /Browser bag lifecycle authority was removed/);
  assert.doesNotMatch(storeSource, /bags:|alarms:|events:/);
});
