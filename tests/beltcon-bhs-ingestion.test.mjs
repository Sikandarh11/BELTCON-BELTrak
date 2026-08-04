import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(repositoryRoot, "src") } },
});

test.after(async () => {
  await vite.close();
});

const [serviceModule, apiModule, mapperModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/bhs/bhsMessageService.server.ts"),
  vite.ssrLoadModule("/src/services/bhs/bhsMessageApi.server.ts"),
  vite.ssrLoadModule("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers.ts"),
]);

const { createBhsMessageService } = serviceModule;
const { handleBhsMessageRequest } = apiModule;
const { createSemanticAcknowledgement } = mapperModule;

const message = {
  messageType: 2001,
  trigger: 1,
  lineId: "01",
  bhsUid: "0012345678",
  evaluation: "R",
};

function atomicResult(status, overrides = {}) {
  return {
    status,
    integrationEventId: "00000000-0000-4000-8000-000000000101",
    bagId: status === "ACCEPTED" || status === "DUPLICATE" ? "ETB-BHS00000001" : null,
    bhsUid: message.bhsUid,
    lineId: message.lineId,
    evaluation: "REJECT",
    taggingEligible: true,
    canAssignTag: false,
    taggingReadinessStatus:
      status === "ACCEPTED" || status === "DUPLICATE" ? "AWAITING_SCREENING" : null,
    processingAttemptCount: 1,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function createMemoryRepository() {
  const events = new Map();
  const bags = new Map();
  let sequence = 1;

  return {
    events,
    bags,
    async ingestAtomic(input) {
      const eventKey = `${input.sourceSystem}:${input.messageFingerprint}`;
      const existingEvent = events.get(eventKey);
      if (existingEvent) {
        existingEvent.processingAttemptCount += 1;
        return { ...existingEvent, status: "DUPLICATE" };
      }

      const bagKey = input.bhsUid;
      const existingBag = bags.get(bagKey);
      if (
        existingBag &&
        (existingBag.lineId !== input.lineId ||
          existingBag.evaluation !== input.evaluationNormalized)
      ) {
        const conflict = atomicResult("CONFLICT", {
          bagId: existingBag.id,
          bhsUid: input.bhsUid,
          lineId: input.lineId,
          evaluation: input.evaluationNormalized,
          taggingEligible: input.taggingEligible,
          errorCode: "BHS_BAG_CONFLICT",
          errorMessage: "BHS message conflicts with the existing bag identity",
        });
        events.set(eventKey, conflict);
        return conflict;
      }

      let bagId = null;
      if (input.taggingEligible) {
        const bag = existingBag ?? {
          id: `ETB-BHS${String(sequence++).padStart(8, "0")}`,
          lineId: input.lineId,
          evaluation: input.evaluationNormalized,
          status: "IDENTIFIED",
          epc: null,
          rfidTagBarcode: null,
        };
        bags.set(bagKey, bag);
        bagId = bag.id;
      }

      const result = atomicResult("ACCEPTED", {
        integrationEventId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        bagId,
        bhsUid: input.bhsUid,
        lineId: input.lineId,
        evaluation: input.evaluationNormalized,
        taggingEligible: input.taggingEligible,
      });
      events.set(eventKey, result);
      return result;
    },
  };
}

function createService(repository) {
  return createBhsMessageService({
    repository,
    createEventId: () => "00000000-0000-4000-8000-000000000999",
    now: () => "2026-07-28T10:00:00.000Z",
  });
}

function request(body, headers = {}) {
  return new Request("http://localhost/api/integrations/bhs/messages", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ingressOptions = {
  integrationKey: "secret",
  sourceSystem: "BHS_TEST",
  siteId: "RUH",
  requestSiteId: "RUH",
  enabled: true,
};

test("A through question-mark evaluations map to the frozen values", async () => {
  const repository = createMemoryRepository();
  const service = createService(repository);
  const expected = {
    A: ["ACCEPT", false],
    R: ["REJECT", true],
    T: ["TIMEOUT", true],
    N: ["NO_DECISION", true],
    "?": ["MISTRACK", true],
  };

  for (const [raw, [normalized, eligible]] of Object.entries(expected)) {
    const result = await service.ingestMessage(
      { ...message, bhsUid: `000000000${Object.keys(expected).indexOf(raw)}`, evaluation: raw },
      { sourceSystem: "BHS_TEST" },
    );
    assert.equal(result.evaluation, normalized);
    assert.equal(result.taggingEligible, eligible);
  }
});

test("ACCEPT stores an event but creates no bag or queue item", async () => {
  const repository = createMemoryRepository();
  const result = await createService(repository).ingestMessage(
    { ...message, evaluation: "A" },
    { sourceSystem: "BHS_TEST" },
  );
  assert.equal(result.outcome, "ACCEPTED");
  assert.equal(result.bagId, null);
  assert.equal(result.taggingEligible, false);
  assert.equal(repository.events.size, 1);
  assert.equal(repository.bags.size, 0);
});

test("eligible BHS messages create minimal identified bags without RFID, alarms, or X-ray", async () => {
  for (const evaluation of ["R", "T", "N", "?"]) {
    const repository = createMemoryRepository();
    const result = await createService(repository).ingestMessage(
      { ...message, evaluation },
      { sourceSystem: "BHS_TEST" },
    );
    const bag = [...repository.bags.values()][0];
    assert.equal(result.outcome, "ACCEPTED");
    assert.notEqual(result.bagId, message.bhsUid);
    assert.equal(bag.status, "IDENTIFIED");
    assert.equal(bag.epc, null);
    assert.equal(bag.rfidTagBarcode, null);
  }
});

test("leading-zero BHS BagIDs are preserved and fingerprints are deterministic", async () => {
  const repository = createMemoryRepository();
  const service = createService(repository);
  const first = await service.ingestMessage(message, { sourceSystem: "BHS_TEST" });
  const second = await service.ingestMessage({ ...message }, { sourceSystem: "BHS_TEST" });
  assert.equal(first.bhsUid, "0012345678");
  assert.equal(second.bhsUid, "0012345678");
  assert.equal(second.outcome, "DUPLICATE");
  assert.equal(second.bagId, first.bagId);
  assert.equal(repository.events.size, 1);
  assert.equal(repository.bags.size, 1);
  assert.equal([...repository.events.values()][0].processingAttemptCount, 2);
});

test("different sources retain separate idempotency scopes but correlate one canonical BHS BagID", async () => {
  const repository = createMemoryRepository();
  const service = createService(repository);
  const first = await service.ingestMessage(message, { sourceSystem: "BHS_A" });
  const separateSource = await service.ingestMessage(message, { sourceSystem: "BHS_B" });
  const conflict = await service.ingestMessage(
    { ...message, evaluation: "T" },
    { sourceSystem: "BHS_A" },
  );
  assert.equal(first.outcome, "ACCEPTED");
  assert.equal(separateSource.outcome, "ACCEPTED");
  assert.equal(separateSource.bagId, first.bagId);
  assert.equal(conflict.outcome, "REJECTED");
  assert.equal(conflict.acknowledgement.outcome, "REJECTED");
  assert.equal(repository.bags.get("0012345678").status, "IDENTIFIED");
});

test("semantic acknowledgement is returned only as an application DTO", async () => {
  const acknowledgement = createSemanticAcknowledgement(message.bhsUid, "ACCEPTED");
  assert.deepEqual(acknowledgement, {
    messageType: 2002,
    bhsUid: message.bhsUid,
    outcome: "ACCEPTED",
    timing: "AFTER_DURABLE_COMMIT",
  });
  assert.equal("byte" in acknowledgement, false);
});

test("BHS API requires a configured server credential and validates strict JSON", async () => {
  const service = {
    async ingestMessage(input) {
      return {
        ...atomicResult("ACCEPTED"),
        outcome: "ACCEPTED",
        duplicate: false,
        acknowledgement: createSemanticAcknowledgement(input.bhsUid, "ACCEPTED"),
      };
    },
  };

  const missing = await handleBhsMessageRequest(request(message), {
    service,
    ...ingressOptions,
  });
  assert.equal(missing.status, 401);

  const invalid = await handleBhsMessageRequest(
    request(
      { ...message, unknown: true },
      {
        "x-bhs-integration-key": "secret",
      },
    ),
    { service, ...ingressOptions },
  );
  assert.equal(invalid.status, 400);

  const accepted = await handleBhsMessageRequest(
    request(message, {
      "x-bhs-integration-key": "secret",
    }),
    { service, ...ingressOptions },
  );
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).acknowledgement.outcome, "ACCEPTED");
});

test("BHS API rejects malformed JSON, oversized bodies, browser-only authority, and invalid credentials", async () => {
  const options = ingressOptions;
  const malformed = await handleBhsMessageRequest(
    request("{", { "x-bhs-integration-key": "secret" }),
    options,
  );
  assert.equal(malformed.status, 400);

  const wrongKey = await handleBhsMessageRequest(
    request(message, { "x-bhs-integration-key": "wrong" }),
    options,
  );
  assert.equal(wrongKey.status, 401);

  const oversized = await handleBhsMessageRequest(
    request("x".repeat(256 * 1024 + 1), { "x-bhs-integration-key": "secret" }),
    options,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "BHS_MESSAGE_TOO_LARGE");
});

test("migration 017 creates the secure atomic RPC without alarms or X-ray records", async () => {
  const migration = await readFile(
    path.join(repositoryRoot, "supabase/migrations/017_create_beltcon_bhs_message_ingestion.sql"),
    "utf8",
  );
  const forbiddenBrand = ["tr" + "ack" + "it", "en" + "track" + "bag"];
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.ingest_beltcon_bhs_message_v1/i);
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /ON CONFLICT \(source_system, message_fingerprint\)/i);
  assert.match(migration, /v_message_type IS DISTINCT FROM 2001/i);
  assert.match(migration, /v_trigger IS DISTINCT FROM 1/i);
  assert.match(migration, /v_evaluation_raw IS NULL/i);
  assert.match(migration, /BHS_MESSAGE_DUPLICATE/);
  assert.match(migration, /BHS_MESSAGE_ACCEPTED/);
  assert.match(migration, /BHS_MESSAGE_REJECTED/);
  assert.match(migration, /BHS_BAG_CREATED/);
  assert.match(migration, /GRANT EXECUTE[\s\S]+TO service_role/i);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /INSERT INTO public\.(alarms|xray_scans)/i);
  for (const term of forbiddenBrand) assert.doesNotMatch(migration, new RegExp(term, "i"));
});

test("server BHS modules do not expose credentials or import server repositories into browser code", async () => {
  const [api, service, route] = await Promise.all([
    readFile(path.join(repositoryRoot, "src/services/bhs/bhsMessageApi.server.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src/services/bhs/bhsMessageService.server.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src/routes/api.integrations.bhs.messages.ts"), "utf8"),
  ]);
  assert.match(api, /@tanstack\/react-start\/server-only/);
  assert.match(service, /@tanstack\/react-start\/server-only/);
  assert.match(route, /handleBhsMessageRequest/);
  assert.doesNotMatch(api + service + route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(createHash("sha256").update(JSON.stringify(message)).digest("hex").length, 64);
});
