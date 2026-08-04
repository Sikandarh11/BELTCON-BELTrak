import assert from "node:assert/strict";
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

const [serviceModule, apiModule, errorModule, repositoryModule, hashModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/screening/screeningIngestionService.server.ts"),
  vite.ssrLoadModule("/src/services/screening/screeningApi.server.ts"),
  vite.ssrLoadModule("/src/services/screening/screeningErrors.ts"),
  vite.ssrLoadModule("/src/services/screening/screeningRepository.server.ts"),
  vite.ssrLoadModule("/src/services/screening/screeningHash.server.ts"),
]);

const { createScreeningIngestionService } = serviceModule;
const { handleScreeningSuspectEventRequest } = apiModule;
const { ScreeningConflictError, ScreeningPersistenceError } = errorModule;
const { createScreeningRepository } = repositoryModule;
const { hashScreeningPayload } = hashModule;

const acceptedEvent = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000101",
  eventType: "BAG_SUSPECTED",
  sourceSystem: "SIMULATED_HBSS",
  occurredAt: "2026-07-24T10:30:00Z",
  bag: {
    bhsUid: "0000000501",
    iataCode: "0123456789",
    iataOrigin: "RUH",
    flightNo: "SV123",
    passengerName: "Test Passenger",
  },
  screening: {
    station: "HBSS-SIM-01",
    screenedAt: "2026-07-24T10:29:00Z",
    notes: "Simulated screening event",
  },
  threat: {
    type: "ORGANIC_DENSITY",
    level: 4,
  },
  scan: {
    externalScanId: "SCAN-501",
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

function identity(sourceSystem, value) {
  return `${sourceSystem}:${value}`;
}

function createMemoryRepository(options = {}) {
  const state = {
    events: new Map(),
    bags: new Map(),
    scans: new Map(),
    audits: [],
  };

  for (const bag of options.bags ?? []) {
    state.bags.set(identity(bag.sourceSystem, bag.bhsUid), structuredClone(bag));
  }
  for (const scan of options.scans ?? []) {
    state.scans.set(identity(scan.sourceSystem, scan.externalScanId), structuredClone(scan));
  }

  return {
    state,
    async ingestAtomic(command) {
      const eventKey = identity(command.event.sourceSystem, command.event.eventId);
      const bhsKey = identity(command.event.sourceSystem, command.event.bag.bhsUid);
      const scanKey = identity(command.event.sourceSystem, command.event.scan.externalScanId);
      const existingEvent = state.events.get(eventKey);

      state.audits.push("SUSPECT_EVENT_RECEIVED");

      if (existingEvent) {
        if (existingEvent.payloadHash !== command.payloadHash) {
          state.audits.push("SUSPECT_EVENT_CONFLICT");
          return {
            status: "CONFLICT",
            eventId: command.event.eventId,
            bagId: existingEvent.bagId,
            scanId: existingEvent.scanId,
            scanStatus: null,
            errorCode: "EVENT_ID_PAYLOAD_CONFLICT",
            errorMessage: "Event ID was already used with a different payload",
          };
        }

        state.audits.push("SUSPECT_EVENT_DUPLICATE");
        return {
          status: "DUPLICATE",
          eventId: command.event.eventId,
          bagId: existingEvent.bagId,
          scanId: existingEvent.scanId,
          scanStatus: existingEvent.scanStatus,
          errorCode: null,
          errorMessage: null,
        };
      }

      const existingBag = state.bags.get(bhsKey);
      if (existingBag) {
        const lifecycleConflict = ["TAGGED", "ALARMED", "AT_RECHECK", "RESOLVED"].includes(
          existingBag.status,
        );
        state.events.set(eventKey, {
          payloadHash: command.payloadHash,
          bagId: existingBag.id,
          scanId: null,
          scanStatus: null,
        });
        state.audits.push("SUSPECT_EVENT_CONFLICT");
        return {
          status: "CONFLICT",
          eventId: command.event.eventId,
          bagId: existingBag.id,
          scanId: null,
          scanStatus: null,
          errorCode: lifecycleConflict ? "BAG_LIFECYCLE_CONFLICT" : "BHS_IDENTITY_CONFLICT",
          errorMessage: lifecycleConflict
            ? "The existing bag lifecycle cannot be reset"
            : "BHS UID is already assigned to another event",
        };
      }

      const existingScan = state.scans.get(scanKey);
      if (existingScan) {
        state.events.set(eventKey, {
          payloadHash: command.payloadHash,
          bagId: existingScan.bagId,
          scanId: existingScan.id,
          scanStatus: existingScan.status,
        });
        state.audits.push("SUSPECT_EVENT_CONFLICT");
        return {
          status: "CONFLICT",
          eventId: command.event.eventId,
          bagId: existingScan.bagId,
          scanId: existingScan.id,
          scanStatus: existingScan.status,
          errorCode: "EXTERNAL_SCAN_ID_CONFLICT",
          errorMessage: "External scan ID is already assigned to another bag",
        };
      }

      const workingBag = {
        id: `ETB-MEM-${state.bags.size + 1}`,
        sourceSystem: command.event.sourceSystem,
        bhsUid: command.event.bag.bhsUid,
        status: "IDENTIFIED",
      };
      const workingEvent = {
        payloadHash: command.payloadHash,
        bagId: workingBag.id,
        scanId: "00000000-0000-4000-8000-000000000201",
        scanStatus: command.event.scan.status,
      };

      if (options.failAfterBag) {
        state.audits.pop();
        state.audits.push("SUSPECT_EVENT_FAILED");
        throw new Error("simulated transaction rollback");
      }

      state.bags.set(bhsKey, workingBag);
      state.scans.set(scanKey, {
        id: workingEvent.scanId,
        bagId: workingBag.id,
        sourceSystem: command.event.sourceSystem,
        externalScanId: command.event.scan.externalScanId,
        status: command.event.scan.status,
      });
      state.events.set(eventKey, workingEvent);
      if (command.event.scan.images.length > 0) {
        state.audits.push("XRAY_IMAGE_REFERENCE_RECEIVED");
      }
      state.audits.push("SUSPECT_EVENT_ACCEPTED");

      return {
        status: "ACCEPTED",
        eventId: command.event.eventId,
        bagId: workingBag.id,
        scanId: workingEvent.scanId,
        scanStatus: workingEvent.scanStatus,
        errorCode: null,
        errorMessage: null,
      };
    },
  };
}

function createService(memoryRepository) {
  return createScreeningIngestionService({
    repository: memoryRepository,
  });
}

function screeningRequest(payload, key = "screening-test-key") {
  return new Request("http://localhost/api/integrations/screening/suspect-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-screening-integration-key": key,
      "x-request-id": "request-501",
    },
    body: JSON.stringify(payload),
  });
}

const apiOptions = {
  integrationKey: "screening-test-key",
  sourceSystem: "SIMULATED_HBSS",
};

test("first suspect event is accepted atomically with bag, scan, and audits", async () => {
  const repository = createMemoryRepository();
  const result = await createService(repository).ingestSuspectEvent(acceptedEvent);

  assert.equal(result.status, "ACCEPTED");
  assert.equal(repository.state.events.size, 1);
  assert.equal(repository.state.bags.size, 1);
  assert.equal(repository.state.scans.size, 1);
  assert.deepEqual(repository.state.audits, [
    "SUSPECT_EVENT_RECEIVED",
    "XRAY_IMAGE_REFERENCE_RECEIVED",
    "SUSPECT_EVENT_ACCEPTED",
  ]);
});

test("same source, event ID, and payload returns the original result", async () => {
  const repository = createMemoryRepository();
  const service = createService(repository);
  const accepted = await service.ingestSuspectEvent(acceptedEvent);
  const duplicate = await service.ingestSuspectEvent(structuredClone(acceptedEvent));

  assert.equal(duplicate.status, "DUPLICATE");
  assert.equal(duplicate.bagId, accepted.bagId);
  assert.equal(duplicate.scanId, accepted.scanId);
  assert.equal(repository.state.bags.size, 1);
  assert.equal(repository.state.scans.size, 1);
  assert.equal(repository.state.audits.at(-1), "SUSPECT_EVENT_DUPLICATE");
});

test("same source and event ID with a changed payload conflicts", async () => {
  const repository = createMemoryRepository();
  const service = createService(repository);
  await service.ingestSuspectEvent(acceptedEvent);

  const changed = structuredClone(acceptedEvent);
  changed.threat.level = 5;
  await assert.rejects(
    () => service.ingestSuspectEvent(changed),
    (error) =>
      error instanceof ScreeningConflictError && error.conflictCode === "EVENT_ID_PAYLOAD_CONFLICT",
  );
  assert.equal(repository.state.bags.size, 1);
  assert.equal(repository.state.scans.size, 1);
});

test("changed duplicate is exposed as HTTP 409 without changing the original", async () => {
  const repository = createMemoryRepository();
  const service = createService(repository);
  const first = await handleScreeningSuspectEventRequest(screeningRequest(acceptedEvent), {
    ...apiOptions,
    service,
  });
  assert.equal(first.status, 201);

  const changed = structuredClone(acceptedEvent);
  changed.threat.type = "METALLIC_OBJECT";
  const conflict = await handleScreeningSuspectEventRequest(screeningRequest(changed), {
    ...apiOptions,
    service,
  });

  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).conflictCode, "EVENT_ID_PAYLOAD_CONFLICT");
  assert.equal(repository.state.bags.size, 1);
  assert.equal(repository.state.scans.size, 1);
});

test("canonical payload hashing is deterministic across object key order", () => {
  const reordered = {
    scan: acceptedEvent.scan,
    threat: acceptedEvent.threat,
    screening: acceptedEvent.screening,
    bag: acceptedEvent.bag,
    occurredAt: acceptedEvent.occurredAt,
    sourceSystem: acceptedEvent.sourceSystem,
    eventType: acceptedEvent.eventType,
    eventId: acceptedEvent.eventId,
    schemaVersion: acceptedEvent.schemaVersion,
  };

  assert.equal(hashScreeningPayload(reordered), hashScreeningPayload(acceptedEvent));
});

test("same BHS UID in a different event conflicts", async () => {
  const repository = createMemoryRepository();
  const service = createService(repository);
  await service.ingestSuspectEvent(acceptedEvent);

  const changed = structuredClone(acceptedEvent);
  changed.eventId = "00000000-0000-4000-8000-000000000102";
  changed.scan.externalScanId = "SCAN-502";
  await assert.rejects(
    () => service.ingestSuspectEvent(changed),
    (error) =>
      error instanceof ScreeningConflictError && error.conflictCode === "BHS_IDENTITY_CONFLICT",
  );
});

test("external scan identity collision never relinks the scan", async () => {
  const repository = createMemoryRepository({
    scans: [
      {
        id: "00000000-0000-4000-8000-000000000299",
        bagId: "ETB-EXISTING",
        sourceSystem: "SIMULATED_HBSS",
        externalScanId: acceptedEvent.scan.externalScanId,
        status: "AVAILABLE",
      },
    ],
  });

  await assert.rejects(
    () => createService(repository).ingestSuspectEvent(acceptedEvent),
    (error) =>
      error instanceof ScreeningConflictError && error.conflictCode === "EXTERNAL_SCAN_ID_CONFLICT",
  );
  assert.equal(
    repository.state.scans.get(identity("SIMULATED_HBSS", acceptedEvent.scan.externalScanId)).bagId,
    "ETB-EXISTING",
  );
  assert.equal(repository.state.bags.size, 0);
});

for (const status of ["TAGGED", "RESOLVED"]) {
  test(`${status} bag conflicts without a lifecycle reset`, async () => {
    const repository = createMemoryRepository({
      bags: [
        {
          id: `ETB-${status}`,
          sourceSystem: "SIMULATED_HBSS",
          bhsUid: acceptedEvent.bag.bhsUid,
          status,
        },
      ],
    });

    await assert.rejects(
      () => createService(repository).ingestSuspectEvent(acceptedEvent),
      (error) =>
        error instanceof ScreeningConflictError && error.conflictCode === "BAG_LIFECYCLE_CONFLICT",
    );
    assert.equal(
      repository.state.bags.get(identity("SIMULATED_HBSS", acceptedEvent.bag.bhsUid)).status,
      status,
    );
  });
}

test("endpoint rejects a missing integration key", async () => {
  const request = screeningRequest(acceptedEvent);
  request.headers.delete("x-screening-integration-key");
  const response = await handleScreeningSuspectEventRequest(request, apiOptions);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SCREENING_UNAUTHORIZED");
});

test("endpoint rejects an incorrect integration key", async () => {
  const response = await handleScreeningSuspectEventRequest(
    screeningRequest(acceptedEvent, "wrong-key"),
    apiOptions,
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SCREENING_UNAUTHORIZED");
});

test("endpoint rejects an invalid body before the service is called", async () => {
  let serviceCalled = false;
  const response = await handleScreeningSuspectEventRequest(
    screeningRequest({ eventType: "BAG_SUSPECTED" }),
    {
      ...apiOptions,
      service: {
        async ingestSuspectEvent() {
          serviceCalled = true;
          throw new Error("should not run");
        },
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(serviceCalled, false);
});

test("endpoint enforces the maximum declared JSON body size", async () => {
  const request = screeningRequest(acceptedEvent);
  request.headers.set("content-length", String(256 * 1024 + 1));
  const response = await handleScreeningSuspectEventRequest(request, apiOptions);
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "SCREENING_PAYLOAD_TOO_LARGE");
});

test("configured source system overrides trust in the request body", async () => {
  let receivedSource;
  const withoutDeclaredSource = structuredClone(acceptedEvent);
  delete withoutDeclaredSource.sourceSystem;
  const response = await handleScreeningSuspectEventRequest(
    screeningRequest(withoutDeclaredSource),
    {
      ...apiOptions,
      service: {
        async ingestSuspectEvent(event) {
          receivedSource = event.sourceSystem;
          return {
            status: "ACCEPTED",
            eventId: event.eventId,
            bagId: "ETB-SOURCE",
            scanId: "00000000-0000-4000-8000-000000000202",
            scanStatus: event.scan.status,
          };
        },
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(receivedSource, "SIMULATED_HBSS");
});

test("endpoint rejects a declared source that does not match its credential mapping", async () => {
  const mismatched = structuredClone(acceptedEvent);
  mismatched.sourceSystem = "UNTRUSTED_VENDOR";
  const response = await handleScreeningSuspectEventRequest(
    screeningRequest(mismatched),
    apiOptions,
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "SCREENING_VALIDATION_ERROR");
});

test("AVAILABLE without images is rejected by endpoint validation", async () => {
  const invalid = structuredClone(acceptedEvent);
  invalid.scan.images = [];
  const response = await handleScreeningSuspectEventRequest(screeningRequest(invalid), apiOptions);
  assert.equal(response.status, 400);
});

test("PENDING without images remains non-blocking", async () => {
  const repository = createMemoryRepository();
  const pending = structuredClone(acceptedEvent);
  pending.scan.status = "PENDING";
  pending.scan.images = [];
  const response = await handleScreeningSuspectEventRequest(screeningRequest(pending), {
    ...apiOptions,
    service: createService(repository),
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).scanStatus, "PENDING");
  assert.equal(repository.state.bags.size, 1);
});

test("failed transaction records a failure audit and leaves no partial bag", async () => {
  const repository = createMemoryRepository({ failAfterBag: true });

  await assert.rejects(
    () => createService(repository).ingestSuspectEvent(acceptedEvent),
    (error) => error instanceof ScreeningPersistenceError,
  );
  assert.equal(repository.state.events.size, 0);
  assert.equal(repository.state.bags.size, 0);
  assert.equal(repository.state.scans.size, 0);
  assert.deepEqual(repository.state.audits, ["SUSPECT_EVENT_FAILED"]);
});

test("repository delegates ingestion through one atomic RPC call", async () => {
  let callCount = 0;
  const repository = createScreeningRepository(async (command) => {
    callCount += 1;
    return {
      data: {
        status: "ACCEPTED",
        eventId: command.event.eventId,
        bagId: "ETB-RPC",
        scanId: "00000000-0000-4000-8000-000000000203",
        scanStatus: "AVAILABLE",
        errorCode: null,
        errorMessage: null,
      },
      error: null,
    };
  });

  await repository.ingestAtomic({
    event: acceptedEvent,
    payloadHash: "a".repeat(64),
    requestId: "request-rpc",
  });
  assert.equal(callCount, 1);
});
