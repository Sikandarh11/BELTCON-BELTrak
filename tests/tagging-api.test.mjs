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

const [serviceModule, apiModule, errorModule, repositoryModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/bags/taggingService.server.ts"),
  vite.ssrLoadModule("/src/services/bags/taggingApi.server.ts"),
  vite.ssrLoadModule("/src/services/bags/taggingErrors.ts"),
  vite.ssrLoadModule("/src/services/bags/taggingRepository.server.ts"),
]);

const { createTaggingService } = serviceModule;
const { handleEncodeTagRequest, handlePendingTaggingRequest } = apiModule;
const { TaggingPersistenceError } = errorModule;
const { mapTaggingBag } = repositoryModule;

function createBag(overrides = {}) {
  return {
    id: "ETB-TAG-001",
    sourceSystem: "SIMULATED_HBSS",
    bhsUid: "BHS-TAG-001",
    iataCode: "0123456001",
    iataOrigin: "RUH",
    flightNo: "SV101",
    passengerName: "Tagging Passenger",
    threatType: "ORGANIC_DENSITY",
    threatLevel: 3,
    screeningStation: "HBSS-SIM-01",
    screenedAt: "2026-07-26T10:00:00.000Z",
    screeningReceivedAt: "2026-07-26T10:00:01.000Z",
    bhsConfirmationStatus: "CONFIRMED",
    bhsConfirmedAt: "2026-07-26T10:00:02.000Z",
    taggingReadiness: "READY_FOR_TAGGING",
    canAssignTag: true,
    status: "IDENTIFIED",
    flaggedAt: "2026-07-26T10:00:00.000Z",
    taggedAt: null,
    epc: null,
    xrayStatus: "AVAILABLE",
    xrayViewCount: 3,
    rfidState: "NOT_ENCODED",
    updatedAt: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

function createMemoryRepository(initialBags = [], options = {}) {
  const state = {
    bags: initialBags.map((bag) => structuredClone(bag)),
    audits: [],
  };

  return {
    state,
    async listPendingTagging() {
      return state.bags
        .filter((bag) => bag.status === "IDENTIFIED")
        .map((bag) => structuredClone(bag));
    },
    async encodeTagAtomic(command) {
      if (options.failEncoding) {
        throw new TaggingPersistenceError("Simulated database failure");
      }

      const bag = state.bags.find((candidate) => candidate.id === command.bagId);
      if (!bag) {
        return { status: "BAG_NOT_FOUND", errorMessage: "Bag was not found" };
      }
      if (bag.taggingReadiness !== "READY_FOR_TAGGING") {
        return {
          status: "TAG_ASSIGNMENT_NOT_READY",
          errorMessage: "Required BHS, screening, threat, and X-ray evidence is incomplete",
        };
      }
      if (bag.status !== "IDENTIFIED" || bag.epc) {
        return {
          status: "ALREADY_TAGGED",
          errorMessage: "Bag is no longer pending RFID encoding",
        };
      }
      if (
        state.bags.some(
          (candidate) =>
            candidate.id !== bag.id && candidate.epc?.toUpperCase() === command.epc.toUpperCase(),
        )
      ) {
        return {
          status: "DUPLICATE_EPC",
          errorMessage: "EPC is already assigned to another bag",
        };
      }

      bag.epc = command.epc;
      bag.status = "TAGGED";
      bag.taggedAt = "2026-07-26T12:00:00.000Z";
      bag.updatedAt = bag.taggedAt;
      bag.rfidState = "ENCODED";
      state.audits.push({
        action: "TAG_ENCODED",
        bagId: bag.id,
        actorId: command.actorId,
        canonicalRole: command.canonicalRole,
      });
      return { status: "ENCODED", bag: structuredClone(bag) };
    },
  };
}

function sessionLookupFor(role) {
  return async () => ({
    token: "tagging-session-token",
    expiresAt: "2026-07-26T14:00:00.000Z",
    user: {
      id: "operations-user",
      firstName: "Operations",
      lastName: "Officer",
      email: "operations@example.com",
      role,
      createdAt: "2026-07-26T08:00:00.000Z",
      lastLogin: null,
    },
  });
}

function pendingRequest() {
  return new Request("http://localhost/api/bags/pending-tagging", {
    method: "GET",
  });
}

function encodeRequest(epc) {
  return new Request("http://localhost/api/bags/ETB-TAG-001/encode-tag", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "tagging-test-request",
    },
    body: JSON.stringify({ epc }),
  });
}

test("an accepted simulator bag appears in the authoritative pending query", async () => {
  const repository = createMemoryRepository();
  const service = createTaggingService(repository);

  repository.state.bags.push(createBag());
  const response = await handlePendingTaggingRequest(pendingRequest(), {
    getSession: sessionLookupFor("Operations Officer"),
    service,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.bags.length, 1);
  assert.equal(body.bags[0].sourceSystem, "SIMULATED_HBSS");
  assert.equal(body.bags[0].bhsUid, "BHS-TAG-001");
});

test("pending Tagging bags are ordered by flagged time ascending", async () => {
  const repository = createMemoryRepository([
    createBag({
      id: "ETB-TAG-LATE",
      bhsUid: "BHS-LATE",
      flaggedAt: "2026-07-26T12:00:00.000Z",
    }),
    createBag({
      id: "ETB-TAG-EARLY",
      bhsUid: "BHS-EARLY",
      flaggedAt: "2026-07-26T09:00:00.000Z",
    }),
  ]);
  const bags = await createTaggingService(repository).listPendingTagging();

  assert.deepEqual(
    bags.map((bag) => bag.id),
    ["ETB-TAG-EARLY", "ETB-TAG-LATE"],
  );
});

test("canonical Operations Officer can access pending Tagging", async () => {
  const response = await handlePendingTaggingRequest(pendingRequest(), {
    getSession: sessionLookupFor("Operations Officer"),
    service: createTaggingService(createMemoryRepository([createBag()])),
  });

  assert.equal(response.status, 200);
});

test("pending Tagging rejects unauthenticated and unauthorized sessions", async () => {
  const service = createTaggingService(createMemoryRepository([createBag()]));
  const unauthenticated = await handlePendingTaggingRequest(pendingRequest(), {
    getSession: async () => null,
    service,
  });
  const unauthorized = await handlePendingTaggingRequest(pendingRequest(), {
    getSession: sessionLookupFor("Unknown Role"),
    service,
  });

  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).code, "TAGGING_UNAUTHORIZED");
  assert.equal(unauthorized.status, 403);
  assert.equal((await unauthorized.json()).code, "TAGGING_FORBIDDEN");
});

test("legacy direct encoding endpoint requires a server-controlled tagging session", async () => {
  const repository = createMemoryRepository([createBag()]);
  const response = await handleEncodeTagRequest(encodeRequest("  epc-tag-001  "), "ETB-TAG-001", {
    getSession: sessionLookupFor("Operations Officer"),
    service: createTaggingService(repository),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "TAGGING_SESSION_REQUIRED");
  assert.equal(repository.state.bags[0].status, "IDENTIFIED");
  assert.equal(repository.state.audits.length, 0);
});

test("duplicate EPC is rejected without changing the pending bag", async () => {
  const repository = createMemoryRepository([
    createBag(),
    createBag({
      id: "ETB-TAG-EXISTING",
      bhsUid: "BHS-EXISTING",
      status: "TAGGED",
      epc: "EPC-DUPLICATE",
      taggedAt: "2026-07-26T11:00:00.000Z",
      rfidState: "ENCODED",
    }),
  ]);
  const response = await handleEncodeTagRequest(encodeRequest("epc-duplicate"), "ETB-TAG-001", {
    getSession: sessionLookupFor("Operations Officer"),
    service: createTaggingService(repository),
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "TAGGING_SESSION_REQUIRED");
  assert.equal(repository.state.bags[0].status, "IDENTIFIED");
  assert.equal(repository.state.audits.length, 0);
});

test("two concurrent encode attempts produce one success and one already-tagged rejection", async () => {
  const repository = createMemoryRepository([createBag()]);
  const service = createTaggingService(repository);
  const results = await Promise.allSettled([
    service.encodeTag({
      bagId: "ETB-TAG-001",
      epc: "EPC-CONCURRENT-A",
      actorId: "operations-user",
      canonicalRole: "Operations Officer",
    }),
    service.encodeTag({
      bagId: "ETB-TAG-001",
      epc: "EPC-CONCURRENT-B",
      actorId: "operations-user",
      canonicalRole: "Operations Officer",
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(repository.state.audits.length, 1);
  assert.equal(repository.state.bags[0].status, "TAGGED");
});

test("legacy direct endpoint cannot mutate an already-tagged bag", async () => {
  const repository = createMemoryRepository([
    createBag({
      status: "TAGGED",
      epc: "EPC-EXISTING",
      taggedAt: "2026-07-26T11:00:00.000Z",
      rfidState: "ENCODED",
    }),
  ]);
  const response = await handleEncodeTagRequest(encodeRequest("EPC-NEW"), "ETB-TAG-001", {
    getSession: sessionLookupFor("Operations Officer"),
    service: createTaggingService(repository),
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "TAGGING_SESSION_REQUIRED");
});

test("legacy direct endpoint is closed before bag lookup", async () => {
  const response = await handleEncodeTagRequest(
    encodeRequest("EPC-MISSING-BAG"),
    "ETB-DOES-NOT-EXIST",
    {
      getSession: sessionLookupFor("Operations Officer"),
      service: createTaggingService(createMemoryRepository()),
    },
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "TAGGING_SESSION_REQUIRED");
});

test("legacy direct endpoint is closed before EPC validation or persistence", async () => {
  let repositoryCalled = false;
  const service = createTaggingService({
    async listPendingTagging() {
      return [];
    },
    async encodeTagAtomic() {
      repositoryCalled = true;
      throw new Error("must not be reached");
    },
  });
  const response = await handleEncodeTagRequest(encodeRequest("not valid / epc"), "ETB-TAG-001", {
    getSession: sessionLookupFor("Operations Officer"),
    service,
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "TAGGING_SESSION_REQUIRED");
  assert.equal(repositoryCalled, false);
});

test("closed legacy endpoint never reaches the database", async () => {
  const repository = createMemoryRepository([createBag()], { failEncoding: true });
  const response = await handleEncodeTagRequest(encodeRequest("EPC-FAIL"), "ETB-TAG-001", {
    getSession: sessionLookupFor("Operations Officer"),
    service: createTaggingService(repository),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "TAGGING_SESSION_REQUIRED");
  assert.equal(repository.state.bags[0].status, "IDENTIFIED");
  assert.equal(repository.state.audits.length, 0);
});

test("BASE_ALWAJH allows RFID tagging without X-Ray evidence", async () => {
  const repository = createMemoryRepository([
    createBag({
      xrayStatus: "NOT_REQUESTED",
      xrayViewCount: 0,
      taggingReadiness: "READY_FOR_TAGGING",
      canAssignTag: true,
    }),
  ]);
  const encoded = await createTaggingService(repository).encodeTag({
    bagId: "ETB-TAG-001",
    epc: "EPC-NO-XRAY",
    actorId: "operations-user",
    canonicalRole: "Operations Officer",
  });

  assert.equal(encoded.epc, "EPC-NO-XRAY");
  assert.equal(encoded.status, "TAGGED");
  assert.equal(repository.state.bags[0].status, "TAGGED");
  assert.equal(repository.state.bags[0].xrayStatus, "NOT_REQUESTED");
});

test("a fresh service instance observes the durable encoded state after reload", async () => {
  const repository = createMemoryRepository([createBag()]);
  await createTaggingService(repository).encodeTag({
    bagId: "ETB-TAG-001",
    epc: "EPC-RELOAD",
    actorId: "operations-user",
    canonicalRole: "Operations Officer",
  });

  const afterReload = await createTaggingService(repository).listPendingTagging();
  assert.deepEqual(afterReload, []);
  assert.equal(repository.state.bags[0].epc, "EPC-RELOAD");
  assert.equal(repository.state.bags[0].status, "TAGGED");
});

test("pending response mapping includes only an X-ray summary, never image data", () => {
  const mapped = mapTaggingBag(
    {
      id: "ETB-TAG-002",
      source_system: "SIMULATED_HBSS",
      bhs_uid: "BHS-TAG-002",
      iata_code: "0123456002",
      iata_origin: "RUH",
      epc: null,
      flight: "SV102",
      passenger_name: "Summary Passenger",
      threat_type: "ORGANIC_DENSITY",
      threat_level: 4,
      screening_station: "HBSS-SIM-01",
      screened_at: "2026-07-26T10:00:00.000Z",
      status: "IDENTIFIED",
      flagged_at: "2026-07-26T10:00:00.000Z",
      tagged_at: null,
      created_at: "2026-07-26T10:00:00.000Z",
      updated_at: "2026-07-26T10:00:00.000Z",
    },
    { status: "AVAILABLE", viewCount: 3 },
  );

  assert.equal(mapped.xrayStatus, "AVAILABLE");
  assert.equal(mapped.xrayViewCount, 3);
  assert.equal("images" in mapped, false);
});

test("tagging migration enforces normalized uniqueness, locking, conditional update, and audit", () => {
  const migration = readFileSync(
    path.join(repositoryRoot, "supabase/migrations/009_create_authoritative_tagging.sql"),
    "utf8",
  );

  assert.match(migration, /idx_bags_epc_normalized_unique/);
  assert.match(migration, /PG_ADVISORY_XACT_LOCK/);
  assert.match(migration, /status = 'IDENTIFIED'\s+AND epc IS NULL/);
  assert.match(migration, /'TAG_ENCODED'/);
  assert.match(migration, /GRANT EXECUTE[\s\S]+TO service_role/);
});

test("legacy bagService encodeTag delegates to the authoritative API", () => {
  const bagServiceSource = readFileSync(
    path.join(repositoryRoot, "src/services/bagService.ts"),
    "utf8",
  );
  const encodeMethod = bagServiceSource.slice(
    bagServiceSource.indexOf("async encodeTag"),
    bagServiceSource.indexOf("async registerRead"),
  );

  assert.match(encodeMethod, /await encodeBagTag\(bagId, epc\)/);
  assert.doesNotMatch(encodeMethod, /updateLifecycle|updateBag|persistenceService/);
});
