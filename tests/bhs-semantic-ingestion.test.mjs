import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test, { after } from "node:test";

import {
  BHS_BASE_MESSAGE,
  createBhsMessage,
  createOversizedBhsBody,
  invalidBhsMessages,
  validBhsMessages,
} from "./fixtures/bhsFixtures.mjs";
import { createProjectModuleLoader } from "./helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
after(() => loader.close());

const [
  schemas,
  mappers,
  serviceModule,
  apiModule,
  repositoryModule,
  simulatorModule,
  pendingModule,
  authorizationModule,
] = await Promise.all([
  loader.load("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts"),
  loader.load("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers.ts"),
  loader.load("/src/services/bhs/bhsMessageService.server.ts"),
  loader.load("/src/services/bhs/bhsMessageApi.server.ts"),
  loader.load("/src/services/bhs/bhsMessageRepository.server.ts"),
  loader.load("/src/services/bhs/bhsSimulatorApi.server.ts"),
  loader.load("/src/services/bhs/bhsPendingConfirmationRepository.server.ts"),
  loader.load("/src/services/authorization/permissionAuthorization.server.ts"),
]);

const { BhsBagMessageV1Schema, BhsAcknowledgementV1Schema } = schemas;
const { createBhsMessageFingerprint } = mappers;
const { createBhsMessageService } = serviceModule;
const { handleBhsMessageRequest } = apiModule;
const { createBhsMessageRepository } = repositoryModule;
const {
  BHS_SIMULATOR_SOURCE_SYSTEM,
  handleBhsPendingConfirmationRequest,
  handleBhsPendingConfirmationsRequest,
  handleBhsSimulatorRequest,
} = simulatorModule;
const { parsePendingBhsConfirmationRow } = pendingModule;
const { PermissionAuthorizationError } = authorizationModule;

const BHS_ENDPOINT = "http://localhost/api/integrations/bhs/messages";
const SIMULATOR_ENDPOINT = "http://localhost/api/dev/simulator/bhs/messages";
const SOURCE_SYSTEM = "BHS_RUH_TEST";
const INTEGRATION_KEY = "bhs-test-key-never-production";

function apiOptions(service, overrides = {}) {
  return {
    service,
    integrationKey: INTEGRATION_KEY,
    sourceSystem: SOURCE_SYSTEM,
    siteId: "RUH",
    requestSiteId: "RUH",
    enabled: true,
    endpointPath: "/api/integrations/bhs/messages",
    ...overrides,
  };
}

function bhsRequest(body, options = {}) {
  const headers = {
    "content-type": "application/json",
    "x-bhs-integration-key": INTEGRATION_KEY,
    ...(options.headers ?? {}),
  };
  return new Request(options.url ?? BHS_ENDPOINT, {
    method: options.method ?? "POST",
    headers,
    body:
      options.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function simulatorRequest(body, options = {}) {
  return new Request(options.url ?? SIMULATOR_ENDPOINT, {
    method: options.method ?? "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body:
      options.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function createDurableRepository() {
  const state = {
    bags: new Map(),
    events: new Map(),
    audits: [],
    calls: [],
    nextBag: 1,
    nextEvent: 1,
  };

  const resultFor = (input, status, event, bag, overrides = {}) => ({
    status,
    integrationEventId: event?.id ?? null,
    bagId: bag?.id ?? null,
    bhsUid: input.bhsUid,
    lineId: input.lineId,
    evaluation: input.evaluationNormalized,
    taggingEligible: input.taggingEligible,
    canAssignTag: bag?.readiness === "READY_FOR_TAGGING",
    taggingReadinessStatus: bag?.readiness ?? null,
    processingAttemptCount: event?.processingAttemptCount ?? 0,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  });

  const repository = {
    state,
    async ingestAtomic(input) {
      state.calls.push(structuredClone(input));
      const eventKey = `${input.sourceSystem}:${input.messageFingerprint}`;
      const duplicate = state.events.get(eventKey);
      if (duplicate) {
        duplicate.processingAttemptCount += 1;
        const bag = duplicate.bagId ? state.bags.get(duplicate.bhsUid) : null;
        state.audits.push({ action: "BHS_MESSAGE_DUPLICATE", bhsUid: input.bhsUid });
        return resultFor(input, "DUPLICATE", duplicate, bag);
      }

      const bag = state.bags.get(input.bhsUid);
      const event = {
        id: `00000000-0000-4000-8000-${String(state.nextEvent++).padStart(12, "0")}`,
        bagId: null,
        bhsUid: input.bhsUid,
        sourceSystem: input.sourceSystem,
        evaluationRaw: input.evaluationRaw,
        processingAttemptCount: 1,
      };
      state.events.set(eventKey, event);

      const priorOppositeEvaluation = [...state.events.values()].find(
        (candidate) =>
          candidate !== event &&
          candidate.bhsUid === input.bhsUid &&
          candidate.evaluationRaw !== input.evaluationRaw,
      );

      if (
        bag &&
        (bag.evaluationRaw !== input.evaluationRaw ||
          bag.lineId !== input.lineId ||
          bag.status !== "IDENTIFIED")
      ) {
        bag.readiness = "BLOCKED_CONFLICT";
        event.bagId = bag.id;
        state.audits.push({ action: "BHS_MESSAGE_REJECTED", bhsUid: input.bhsUid });
        return resultFor(input, "CONFLICT", event, bag, {
          taggingEligible: false,
          canAssignTag: false,
          errorCode: "BHS_CONFIRMATION_CONFLICT",
          errorMessage: "BHS confirmation conflicts with the canonical bag",
        });
      }

      if (!input.taggingEligible) {
        state.audits.push({ action: "BHS_MESSAGE_ACCEPTED", bhsUid: input.bhsUid });
        return resultFor(input, "ACCEPTED", event, null);
      }

      const canonicalBag = bag ?? {
        id: `ETB-${String(state.nextBag++).padStart(12, "0")}`,
        bhsUid: input.bhsUid,
        lineId: input.lineId,
        evaluationRaw: input.evaluationRaw,
        evaluation: input.evaluationNormalized,
        sourceSystem: input.sourceSystem,
        status: "IDENTIFIED",
        readiness: "AWAITING_SCREENING",
        epc: null,
        rfidTagBarcode: null,
        createdAt: input.receivedAt,
        updatedAt: input.receivedAt,
      };
      state.bags.set(input.bhsUid, canonicalBag);
      event.bagId = canonicalBag.id;
      if (priorOppositeEvaluation) {
        canonicalBag.readiness = "BLOCKED_CONFLICT";
        state.audits.push({ action: "BHS_MESSAGE_REJECTED", bhsUid: input.bhsUid });
        return resultFor(input, "CONFLICT", event, canonicalBag, {
          taggingEligible: false,
          canAssignTag: false,
          errorCode: "BHS_CONFIRMATION_CONFLICT",
          errorMessage: "BHS confirmation conflicts with an earlier semantic evaluation",
        });
      }
      state.audits.push({
        action: bag ? "BHS_BAG_LINKED" : "BHS_BAG_CREATED",
        bhsUid: input.bhsUid,
      });
      return resultFor(input, "ACCEPTED", event, canonicalBag);
    },
  };
  return repository;
}

function createService(repository, overrides = {}) {
  let eventSequence = 1;
  return createBhsMessageService({
    repository,
    createEventId: () => `00000000-0000-4000-8001-${String(eventSequence++).padStart(12, "0")}`,
    now: () => "2026-08-02T10:00:00.000Z",
    ...overrides,
  });
}

function successfulApiService(overrides = {}) {
  const calls = [];
  return {
    calls,
    async ingestMessage(message, context) {
      calls.push({ message: structuredClone(message), context: structuredClone(context) });
      const outcome = overrides.outcome ?? "ACCEPTED";
      const acknowledgement = {
        messageType: 2002,
        bhsUid: message.bhsUid,
        outcome,
        timing: "AFTER_DURABLE_COMMIT",
      };
      return {
        outcome,
        integrationEventId: "00000000-0000-4000-8000-000000000901",
        bagId: message.evaluation === "A" ? null : "ETB-000000000901",
        bhsUid: message.bhsUid,
        lineId: message.lineId,
        evaluation: "REJECT",
        taggingEligible: message.evaluation !== "A",
        canAssignTag: false,
        taggingReadinessStatus: message.evaluation === "A" ? null : "AWAITING_SCREENING",
        duplicate: outcome === "DUPLICATE",
        processingAttemptCount: 1,
        errorCode: overrides.errorCode ?? null,
        errorMessage: overrides.errorMessage ?? null,
        acknowledgement,
      };
    },
  };
}

const simulatorSession = {
  user: {
    id: "00000000-0000-4000-8000-000000000777",
    email: "simulator@test.invalid",
    role: "System Administrator",
    status: "ACTIVE",
  },
};

function simulatorOptions(service, overrides = {}) {
  return {
    service,
    environment: "test",
    featureEnabled: true,
    getSession: async () => simulatorSession,
    requirePermission: async () => undefined,
    ...overrides,
  };
}

test("P2-BHS-001 Valid ACCEPT", async () => {
  const parsed = BhsBagMessageV1Schema.parse(validBhsMessages.accept);
  assert.deepEqual(parsed, validBhsMessages.accept);
  const repository = createDurableRepository();
  const result = await createService(repository).ingestMessage(parsed, {
    sourceSystem: SOURCE_SYSTEM,
  });
  assert.equal(result.outcome, "ACCEPTED");
  assert.equal(result.bagId, null);
  assert.equal(result.canAssignTag, false);
  assert.equal(result.taggingReadinessStatus, null);
  assert.equal(repository.state.events.size, 1);
  assert.equal(repository.state.bags.size, 0);
  assert.deepEqual(BhsAcknowledgementV1Schema.parse(result.acknowledgement), {
    messageType: 2002,
    bhsUid: "1234567890",
    outcome: "ACCEPTED",
    timing: "AFTER_DURABLE_COMMIT",
  });
});

test("P2-BHS-002 Valid REJECT and supported non-ACCEPT evaluations", async (t) => {
  const cases = [
    [validBhsMessages.reject, "REJECT"],
    [validBhsMessages.timeout, "TIMEOUT"],
    [validBhsMessages.noDecision, "NO_DECISION"],
    [validBhsMessages.mistrack, "MISTRACK"],
  ];
  for (const [index, [fixture, normalized]] of cases.entries()) {
    await t.test(normalized, async () => {
      const repository = createDurableRepository();
      const message = { ...fixture, bhsUid: `000000100${index}` };
      const result = await createService(repository).ingestMessage(message, {
        sourceSystem: SOURCE_SYSTEM,
      });
      const bag = repository.state.bags.get(message.bhsUid);
      assert.equal(result.outcome, "ACCEPTED");
      assert.equal(result.evaluation, normalized);
      assert.equal(result.taggingEligible, true);
      assert.equal(result.canAssignTag, false);
      assert.equal(result.taggingReadinessStatus, "AWAITING_SCREENING");
      assert.match(result.bagId, /^ETB-/);
      assert.notEqual(result.bagId, message.bhsUid);
      assert.equal(bag.bhsUid, message.bhsUid);
      assert.equal(bag.lineId, message.lineId);
      assert.equal(bag.evaluationRaw, message.evaluation);
      assert.equal(bag.sourceSystem, SOURCE_SYSTEM);
      assert.equal(bag.epc, null);
    });
  }
});

test("P2-BHS-003 Invalid BHS messages fail before repository or RPC", async (t) => {
  for (const fixture of invalidBhsMessages) {
    await t.test(fixture.id, async () => {
      assert.equal(BhsBagMessageV1Schema.safeParse(fixture.message).success, false, fixture.reason);
      const service = successfulApiService();
      const response = await handleBhsMessageRequest(
        bhsRequest(fixture.message),
        apiOptions(service),
      );
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.code, "BHS_INVALID_MESSAGE");
      assert.equal("acknowledgement" in body, false);
      assert.equal(service.calls.length, 0);
      assert.equal(Object.prototype.polluted, undefined);
    });
  }

  const service = successfulApiService();
  const oversized = await handleBhsMessageRequest(
    bhsRequest(createOversizedBhsBody()),
    apiOptions(service),
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "BHS_MESSAGE_TOO_LARGE");
  assert.equal(service.calls.length, 0);
});

test("P2-BHS-004 Exact duplicate variants reuse one durable event and bag", async () => {
  assert.equal(
    createBhsMessageFingerprint(BHS_BASE_MESSAGE),
    "beltcon-sbts-v1:4:2001|1:1|2:01|10:1234567890|1:R",
  );
  const repository = createDurableRepository();
  const firstService = createService(repository);
  const sameObject = validBhsMessages.leadingZeros;
  const first = await firstService.ingestMessage(sameObject, { sourceSystem: SOURCE_SYSTEM });
  const second = await firstService.ingestMessage(sameObject, { sourceSystem: SOURCE_SYSTEM });
  const reconstructed = await firstService.ingestMessage(
    { ...validBhsMessages.leadingZeros },
    { sourceSystem: SOURCE_SYSTEM },
  );
  const restarted = await createService(repository).ingestMessage(
    { ...validBhsMessages.leadingZeros },
    { sourceSystem: SOURCE_SYSTEM },
  );
  assert.equal(first.outcome, "ACCEPTED");
  for (const result of [second, reconstructed, restarted]) {
    assert.equal(result.outcome, "DUPLICATE");
    assert.equal(result.bagId, first.bagId);
    assert.equal(result.acknowledgement.outcome, "DUPLICATE");
    assert.equal(result.taggingReadinessStatus, "AWAITING_SCREENING");
  }
  assert.equal(repository.state.bags.size, 1);
  assert.equal(repository.state.events.size, 1);
});

test("P2-BHS-005 Concurrent duplicate", async () => {
  const repository = createDurableRepository();
  const service = createService(repository);
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      service.ingestMessage({ ...BHS_BASE_MESSAGE }, { sourceSystem: SOURCE_SYSTEM }),
    ),
  );
  assert.equal(results.filter((result) => result.outcome === "ACCEPTED").length, 1);
  assert.equal(results.filter((result) => result.outcome === "DUPLICATE").length, 49);
  assert.equal(new Set(results.map((result) => result.bagId)).size, 1);
  assert.equal(repository.state.bags.size, 1);
  assert.equal(repository.state.events.size, 1);
});

test("P2-BHS-006 Same UID different evaluation, line, trigger, and case", async () => {
  const repository = createDurableRepository();
  const service = createService(repository);
  const original = await service.ingestMessage(createBhsMessage(), { sourceSystem: SOURCE_SYSTEM });
  const evaluationConflict = await service.ingestMessage(createBhsMessage({ evaluation: "A" }), {
    sourceSystem: SOURCE_SYSTEM,
  });
  const lineConflict = await service.ingestMessage(createBhsMessage({ lineId: "02" }), {
    sourceSystem: SOURCE_SYSTEM,
  });
  assert.equal(evaluationConflict.outcome, "REJECTED");
  assert.equal(lineConflict.outcome, "REJECTED");
  assert.equal(evaluationConflict.bagId, original.bagId);
  assert.equal(repository.state.bags.size, 1);
  assert.equal(BhsBagMessageV1Schema.safeParse(createBhsMessage({ trigger: 2 })).success, false);
  assert.notEqual(
    createBhsMessageFingerprint(validBhsMessages.uppercase),
    createBhsMessageFingerprint(validBhsMessages.lowercase),
  );
  await service.ingestMessage(validBhsMessages.uppercase, { sourceSystem: SOURCE_SYSTEM });
  await service.ingestMessage(validBhsMessages.lowercase, { sourceSystem: SOURCE_SYSTEM });
  assert.equal(repository.state.bags.size, 3);
});

test("P2-BHS-007 ACCEPT after REJECT creates a visible sticky conflict", async () => {
  const repository = createDurableRepository();
  const service = createService(repository);
  const reject = await service.ingestMessage(createBhsMessage(), { sourceSystem: SOURCE_SYSTEM });
  const accept = await service.ingestMessage(createBhsMessage({ evaluation: "A" }), {
    sourceSystem: SOURCE_SYSTEM,
  });
  const bag = repository.state.bags.get(BHS_BASE_MESSAGE.bhsUid);
  assert.equal(accept.outcome, "REJECTED");
  assert.equal(accept.bagId, reject.bagId);
  assert.equal(bag.readiness, "BLOCKED_CONFLICT");
  assert.equal(bag.status, "IDENTIFIED");
  assert.equal(repository.state.events.size, 2);
});

test("P2-BHS-008 REJECT after ACCEPT creates the same visible conflict", async () => {
  const repository = createDurableRepository();
  const service = createService(repository);
  const accept = await service.ingestMessage(createBhsMessage({ evaluation: "A" }), {
    sourceSystem: SOURCE_SYSTEM,
  });
  const reject = await service.ingestMessage(createBhsMessage({ evaluation: "R" }), {
    sourceSystem: SOURCE_SYSTEM,
  });
  assert.equal(accept.bagId, null);
  assert.equal(reject.outcome, "REJECTED");
  assert.match(reject.bagId, /^ETB-/);
  assert.equal(reject.taggingReadinessStatus, "BLOCKED_CONFLICT");
  assert.equal(repository.state.events.size, 2);
  assert.equal(repository.state.bags.size, 1);
});

test("P2-BHS-009 HBSS-first confirmation retains the internal bag identity", async () => {
  const repository = createDurableRepository();
  repository.state.bags.set("0000009009", {
    id: "ETB-HBSS-FIRST-009",
    bhsUid: "0000009009",
    lineId: "01",
    evaluationRaw: "R",
    evaluation: "REJECT",
    sourceSystem: "HBSS_RUH_TEST",
    status: "IDENTIFIED",
    readiness: "AWAITING_BHS",
    epc: null,
    rfidTagBarcode: null,
  });
  const result = await createService(repository).ingestMessage(
    createBhsMessage({ bhsUid: "0000009009" }),
    { sourceSystem: SOURCE_SYSTEM },
  );
  assert.equal(result.bagId, "ETB-HBSS-FIRST-009");
  assert.equal(repository.state.bags.size, 1);
});

test("P2-BHS-010 HBSS conflict remains blocked", async () => {
  const repository = createDurableRepository();
  repository.state.bags.set("0000009010", {
    id: "ETB-HBSS-FIRST-010",
    bhsUid: "0000009010",
    lineId: "01",
    evaluationRaw: "R",
    evaluation: "REJECT",
    sourceSystem: "HBSS_RUH_TEST",
    status: "IDENTIFIED",
    readiness: "AWAITING_BHS",
    epc: null,
    rfidTagBarcode: null,
  });
  const result = await createService(repository).ingestMessage(
    createBhsMessage({ bhsUid: "0000009010", evaluation: "A" }),
    { sourceSystem: SOURCE_SYSTEM },
  );
  assert.equal(result.outcome, "REJECTED");
  assert.equal(result.taggingReadinessStatus, "BLOCKED_CONFLICT");
  assert.equal(repository.state.bags.get("0000009010").status, "IDENTIFIED");
});

test("P2-BHS-011 Transaction and repository failures never return false success", async (t) => {
  await t.test("RPC-reported failure produces semantic FAILED", async () => {
    const repository = {
      async ingestAtomic(input) {
        return {
          status: "FAILED",
          integrationEventId: null,
          bagId: null,
          bhsUid: input.bhsUid,
          lineId: input.lineId,
          evaluation: null,
          taggingEligible: false,
          canAssignTag: false,
          taggingReadinessStatus: null,
          processingAttemptCount: 0,
          errorCode: "BHS_PROCESSING_FAILED",
          errorMessage: "BHS message could not be processed",
        };
      },
    };
    const result = await createService(repository).ingestMessage(createBhsMessage(), {
      sourceSystem: SOURCE_SYSTEM,
    });
    assert.equal(result.outcome, "FAILED");
    assert.equal(result.acknowledgement.outcome, "FAILED");
    assert.equal(result.bagId, null);
  });

  await t.test("invalid RPC result and thrown connection errors are sanitized", async () => {
    const invalidRepository = createBhsMessageRepository(async () => ({
      data: { status: "ACCEPTED" },
      error: null,
    }));
    await assert.rejects(
      () =>
        createService(invalidRepository).ingestMessage(createBhsMessage(), {
          sourceSystem: SOURCE_SYSTEM,
        }),
      (error) => error.code === "BHS_PROCESSING_FAILED" && !error.message.includes("stack"),
    );
    const unavailable = createBhsMessageRepository(async () => {
      throw new Error("database-password=never-return-this");
    });
    const response = await handleBhsMessageRequest(
      bhsRequest(createBhsMessage()),
      apiOptions(createService(unavailable)),
    );
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.code, "BHS_PROCESSING_FAILED");
    assert.doesNotMatch(JSON.stringify(body), /database-password|stack/i);
  });

  await t.test("mismatched RPC identity cannot create acknowledgement 2002", async () => {
    const repository = {
      async ingestAtomic(input) {
        return {
          status: "ACCEPTED",
          integrationEventId: "00000000-0000-4000-8000-000000000911",
          bagId: "ETB-WRONG-IDENTITY",
          bhsUid: "0987654321",
          lineId: input.lineId,
          evaluation: input.evaluationNormalized,
          taggingEligible: true,
          canAssignTag: false,
          taggingReadinessStatus: "AWAITING_SCREENING",
          processingAttemptCount: 1,
          errorCode: null,
          errorMessage: null,
        };
      },
    };
    await assert.rejects(
      () =>
        createService(repository).ingestMessage(createBhsMessage(), {
          sourceSystem: SOURCE_SYSTEM,
        }),
      (error) =>
        error.code === "BHS_PROCESSING_FAILED" &&
        /mismatched message identity/i.test(error.message),
    );
  });
});

test("P2-BHS-012 Response-loss retry is database-backed and idempotent", async () => {
  const repository = createDurableRepository();
  await createService(repository).ingestMessage(createBhsMessage(), {
    sourceSystem: SOURCE_SYSTEM,
  });
  const retryAfterLostResponse = await createService(repository).ingestMessage(createBhsMessage(), {
    sourceSystem: SOURCE_SYSTEM,
  });
  assert.equal(retryAfterLostResponse.outcome, "DUPLICATE");
  assert.equal(repository.state.events.size, 1);
  assert.equal(repository.state.bags.size, 1);
});

test("P2-BHS-013 Authentication and configuration failures are fail-closed", async () => {
  const service = successfulApiService();
  const cases = [
    [
      bhsRequest(createBhsMessage(), { headers: { "x-bhs-integration-key": "" } }),
      apiOptions(service),
      401,
    ],
    [
      bhsRequest(createBhsMessage(), { headers: { "x-bhs-integration-key": "wrong" } }),
      apiOptions(service),
      401,
    ],
    [bhsRequest(createBhsMessage()), apiOptions(service, { enabled: false }), 503],
    [bhsRequest(createBhsMessage()), apiOptions(service, { sourceSystem: null }), 503],
    [bhsRequest(createBhsMessage()), apiOptions(service, { siteId: null }), 503],
    [bhsRequest(createBhsMessage()), apiOptions(service, { requestSiteId: "DOH" }), 403],
    [
      bhsRequest(createBhsMessage(), { url: "http://localhost/api/integrations/hbss/scans" }),
      apiOptions(service),
      403,
    ],
    [
      bhsRequest(createBhsMessage(), { headers: { "x-bhs-integration-key": "hbss-key" } }),
      apiOptions(service),
      401,
    ],
  ];
  for (const [request, options, expectedStatus] of cases) {
    const response = await handleBhsMessageRequest(request, options);
    const body = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.doesNotMatch(JSON.stringify(body), /bhs-test-key|hbss-key|expected credential/i);
  }
  assert.equal(service.calls.length, 0);
});

test("P2-BHS-014 Trusted source cannot be spoofed", async () => {
  const service = successfulApiService();
  const valid = await handleBhsMessageRequest(bhsRequest(createBhsMessage()), apiOptions(service));
  assert.equal(valid.status, 200);
  assert.equal(service.calls[0].context.sourceSystem, SOURCE_SYSTEM);
  assert.equal(service.calls[0].context.siteId, "RUH");

  for (const spoof of [
    { ...createBhsMessage(), sourceSystem: "ATTACKER" },
    { ...createBhsMessage(), siteId: "DOH" },
  ]) {
    const response = await handleBhsMessageRequest(bhsRequest(spoof), apiOptions(service));
    assert.equal(response.status, 400);
  }
  assert.equal(service.calls.length, 1);
});

test("P2-BHS-015 Pending confirmation uses server-loaded identity and evaluation", async () => {
  const calls = [];
  const service = {
    async ingestMessage(message, context) {
      calls.push({ message, context });
      return successfulApiService().ingestMessage(message, context);
    },
  };
  const pending = {
    bagId: "ETB-PENDING-015",
    bhsUid: "0000009015",
    screeningEvaluationRaw: "R",
    screeningEvaluation: "REJECT",
    screeningStation: "HBSS-RUH-01",
    screenedAt: "2026-08-02T09:00:00.000Z",
    threatSummary: "TEST · Level 3",
    xrayAvailable: true,
    confirmationStatus: "AWAITING_BHS_CONFIRMATION",
  };
  const pendingRepository = {
    async listPending() {
      return [pending];
    },
    async getPending(bagId) {
      return bagId === pending.bagId ? pending : null;
    },
  };
  const list = await handleBhsPendingConfirmationsRequest(
    simulatorRequest(null, {
      method: "GET",
      url: "http://localhost/api/dev/simulator/bhs/pending-confirmations",
    }),
    simulatorOptions(service, { pendingRepository }),
  );
  assert.deepEqual((await list.json()).items, [pending]);
  const confirmed = await handleBhsPendingConfirmationRequest(
    simulatorRequest({ lineId: "01", trigger: 1 }),
    pending.bagId,
    simulatorOptions(service, { pendingRepository }),
  );
  assert.equal(confirmed.status, 200);
  assert.deepEqual(calls[0].message, {
    messageType: 2001,
    trigger: 1,
    lineId: "01",
    bhsUid: pending.bhsUid,
    evaluation: pending.screeningEvaluationRaw,
  });
  assert.equal(calls[0].context.sourceSystem, BHS_SIMULATOR_SOURCE_SYSTEM);

  const wrongBag = await handleBhsPendingConfirmationRequest(
    simulatorRequest({ lineId: "01", trigger: 1 }),
    "ETB-WRONG-PENDING",
    simulatorOptions(service, { pendingRepository }),
  );
  assert.equal(wrongBag.status, 409);
  const spoofedEvaluation = await handleBhsPendingConfirmationRequest(
    simulatorRequest({ lineId: "01", trigger: 1, evaluation: "A" }),
    pending.bagId,
    simulatorOptions(service, { pendingRepository }),
  );
  assert.equal(spoofedEvaluation.status, 400);
  assert.equal(calls.length, 1);

  const storedRow = {
    id: pending.bagId,
    bhs_uid: pending.bhsUid,
    screening_evaluation_raw: "R",
    screening_evaluation: "REJECT",
    screening_station: pending.screeningStation,
    screened_at: pending.screenedAt,
    threat_type: "TEST",
    threat_level: 3,
    bhs_confirmation_status: "AWAITING_BHS_CONFIRMATION",
    status: "IDENTIFIED",
    epc: null,
    rfid_tag_barcode: null,
  };
  assert.equal(parsePendingBhsConfirmationRow(storedRow, true)?.bhsUid, pending.bhsUid);
  assert.equal(
    parsePendingBhsConfirmationRow({ ...storedRow, bhs_uid: "legacy-invalid" }, true),
    null,
  );

  const concurrentRepository = createDurableRepository();
  const concurrentService = createService(concurrentRepository);
  const confirmationRequest = () => simulatorRequest({ lineId: "01", trigger: 1 });
  const confirmations = await Promise.all([
    handleBhsPendingConfirmationRequest(
      confirmationRequest(),
      pending.bagId,
      simulatorOptions(concurrentService, { pendingRepository }),
    ),
    handleBhsPendingConfirmationRequest(
      confirmationRequest(),
      pending.bagId,
      simulatorOptions(concurrentService, { pendingRepository }),
    ),
  ]);
  assert.deepEqual(
    (await Promise.all(confirmations.map((response) => response.json())))
      .map((body) => body.result.outcome)
      .sort(),
    ["ACCEPTED", "DUPLICATE"],
  );
  assert.equal(concurrentRepository.state.bags.size, 1);
});

test("P2-BHS-016 Restart and reconnect recovery retains durable identity", async () => {
  const repository = createDurableRepository();
  const beforeRestart = await createService(repository).ingestMessage(createBhsMessage(), {
    sourceSystem: SOURCE_SYSTEM,
  });
  const afterRestart = await createService(repository).ingestMessage(createBhsMessage(), {
    sourceSystem: SOURCE_SYSTEM,
  });
  assert.equal(afterRestart.outcome, "DUPLICATE");
  assert.equal(afterRestart.bagId, beforeRestart.bagId);
  assert.equal(afterRestart.taggingReadinessStatus, beforeRestart.taggingReadinessStatus);
});

test("P2-BHS-017 Readiness fields survive the repository and service boundary", async () => {
  const rpcResult = {
    status: "ACCEPTED",
    integrationEventId: "00000000-0000-4000-8000-000000000917",
    bagId: "ETB-READINESS-917",
    bhsUid: "0000009017",
    lineId: "01",
    evaluation: "REJECT",
    taggingEligible: true,
    canAssignTag: false,
    taggingReadinessStatus: "AWAITING_SCREENING",
    processingAttemptCount: 1,
    errorCode: null,
    errorMessage: null,
  };
  const repository = createBhsMessageRepository(async () => ({ data: rpcResult, error: null }));
  const result = await createService(repository).ingestMessage(
    createBhsMessage({ bhsUid: "0000009017" }),
    { sourceSystem: SOURCE_SYSTEM },
  );
  assert.equal(result.taggingEligible, true);
  assert.equal(result.canAssignTag, false);
  assert.equal(result.taggingReadinessStatus, "AWAITING_SCREENING");
});

test("P2-BHS-018 Closed and tagged bags reject new semantics without destructive rollback", async () => {
  for (const status of ["TAGGED", "ALARMED", "RESOLVED"]) {
    const repository = createDurableRepository();
    const bhsUid = `00000090${status === "TAGGED" ? "18" : status === "ALARMED" ? "19" : "20"}`;
    repository.state.bags.set(bhsUid, {
      id: `ETB-${status}-018`,
      bhsUid,
      lineId: "01",
      evaluationRaw: "R",
      evaluation: "REJECT",
      sourceSystem: SOURCE_SYSTEM,
      status,
      readiness: status === "TAGGED" ? "READY_FOR_TAGGING" : "NOT_READY",
      epc: "EPC-HISTORICAL",
      rfidTagBarcode: "TAG-HISTORICAL",
    });
    const result = await createService(repository).ingestMessage(
      createBhsMessage({ bhsUid, evaluation: "A" }),
      { sourceSystem: SOURCE_SYSTEM },
    );
    const bag = repository.state.bags.get(bhsUid);
    assert.equal(result.outcome, "REJECTED");
    assert.equal(bag.status, status);
    assert.equal(bag.epc, "EPC-HISTORICAL");
    assert.equal(bag.rfidTagBarcode, "TAG-HISTORICAL");
    assert.equal(bag.readiness, "BLOCKED_CONFLICT");
  }
});

test("P2-BHS-019 Simulator uses the canonical service and remains disabled in production", async () => {
  const repository = createDurableRepository();
  const service = createService(repository);
  const acceptMessage = createBhsMessage({ bhsUid: "0000009019", evaluation: "A" });
  const rejectMessage = createBhsMessage({ bhsUid: "0000009020", evaluation: "R" });
  const accept = await handleBhsSimulatorRequest(
    simulatorRequest(acceptMessage),
    simulatorOptions(service),
  );
  const accepted = await handleBhsSimulatorRequest(
    simulatorRequest(rejectMessage),
    simulatorOptions(service),
  );
  const duplicate = await handleBhsSimulatorRequest(
    simulatorRequest({ ...rejectMessage }),
    simulatorOptions(service),
  );
  const conflict = await handleBhsSimulatorRequest(
    simulatorRequest({ ...rejectMessage, evaluation: "A" }),
    simulatorOptions(service),
  );
  assert.equal(accept.status, 200);
  assert.equal(accepted.status, 200);
  assert.equal((await duplicate.json()).result.outcome, "DUPLICATE");
  assert.equal(conflict.status, 409);
  assert.equal(repository.state.bags.size, 1);
  assert.equal(repository.state.calls[0].sourceSystem, BHS_SIMULATOR_SOURCE_SYSTEM);

  const invalid = await handleBhsSimulatorRequest(
    simulatorRequest(createBhsMessage({ bhsUid: "short" })),
    simulatorOptions(service),
  );
  assert.equal(invalid.status, 400);
  assert.equal(repository.state.calls.length, 4);

  const oversized = await handleBhsSimulatorRequest(
    simulatorRequest(createOversizedBhsBody()),
    simulatorOptions(service),
  );
  assert.equal(oversized.status, 413);

  const production = await handleBhsSimulatorRequest(
    simulatorRequest(createBhsMessage()),
    simulatorOptions(service, { environment: "production", featureEnabled: true }),
  );
  assert.equal(production.status, 403);

  const unauthorized = await handleBhsSimulatorRequest(
    simulatorRequest(createBhsMessage()),
    simulatorOptions(service, { getSession: async () => null }),
  );
  assert.equal(unauthorized.status, 401);
  const forbidden = await handleBhsSimulatorRequest(
    simulatorRequest(createBhsMessage()),
    simulatorOptions(service, {
      requirePermission: async () => {
        throw new PermissionAuthorizationError("Permission denied", "PERMISSION_DENIED", 403);
      },
    }),
  );
  assert.equal(forbidden.status, 403);
});

test("P2-BHS-020 Software load remains deterministic without claiming PLC throughput", async () => {
  const repository = createDurableRepository();
  const service = createService(repository);
  const started = performance.now();
  for (let index = 0; index < 100; index += 1) {
    await service.ingestMessage(createBhsMessage({ bhsUid: String(1_000_000_000 + index) }), {
      sourceSystem: SOURCE_SYSTEM,
    });
  }
  const duplicates = await Promise.all(
    Array.from({ length: 100 }, () =>
      service.ingestMessage(createBhsMessage({ bhsUid: "1000000000" }), {
        sourceSystem: SOURCE_SYSTEM,
      }),
    ),
  );
  const independent = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      service.ingestMessage(createBhsMessage({ bhsUid: String(2_000_000_000 + index) }), {
        sourceSystem: SOURCE_SYSTEM,
      }),
    ),
  );
  const elapsedMs = performance.now() - started;
  assert.equal(
    duplicates.every((result) => result.outcome === "DUPLICATE"),
    true,
  );
  assert.equal(
    independent.every((result) => result.outcome === "ACCEPTED"),
    true,
  );
  assert.equal(repository.state.bags.size, 150);
  assert.equal(repository.state.events.size, 150);
  assert.ok(elapsedMs < 5_000, `software-only test took ${elapsedMs.toFixed(1)} ms`);
});
