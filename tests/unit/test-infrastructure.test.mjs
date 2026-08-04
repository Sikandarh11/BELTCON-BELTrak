import assert from "node:assert/strict";
import test from "node:test";

import { createRfidEvent } from "../fixtures/tagFixtures.mjs";
import { createTaggingOperator } from "../fixtures/userFixtures.mjs";
import {
  createAuthenticatedRequest,
  createMockSessionLookup,
} from "../helpers/createAuthenticatedRequest.mjs";
import { expectAuditEvent } from "../helpers/expectAuditEvent.mjs";
import { expectDomainError } from "../helpers/expectDomainError.mjs";
import { createTestContext } from "../helpers/createTestContext.mjs";
import { DEFAULT_CLOCK_TIME, installFakeTimers } from "../mocks/clockMock.mjs";

test("the deterministic context supplies resettable clocks and UUIDs", (t) => {
  const context = createTestContext(t);
  assert.equal(context.clock.nowIso(), DEFAULT_CLOCK_TIME);
  assert.equal(context.uuid(), "00000000-0000-4000-8000-000000000001");
  context.clock.advance(1_000);
  assert.equal(context.clock.nowIso(), "2026-07-30T10:00:01.000Z");
  context.reset();
  assert.equal(context.clock.nowIso(), DEFAULT_CLOCK_TIME);
  assert.equal(context.uuid(), "00000000-0000-4000-8000-000000000001");
});

test("Node fake timers control Date without sleep calls", (t) => {
  const timers = installFakeTimers(t);
  assert.equal(new Date().toISOString(), DEFAULT_CLOCK_TIME);
  timers.tick(5_000);
  assert.equal(new Date().toISOString(), "2026-07-30T10:00:05.000Z");
});

test("authenticated request and session helpers use the real cookie and session shape", async () => {
  const operator = createTaggingOperator();
  const request = createAuthenticatedRequest("http://localhost/api/bags/pending-tagging");
  const lookup = createMockSessionLookup(operator);
  const session = await lookup(request);

  assert.match(request.headers.get("cookie"), /etb_auth_token=p1-test-access-token/);
  assert.equal(request.headers.get("x-request-id"), "request-p1-001");
  assert.equal(session.user.id, operator.id);
  assert.equal(session.user.role, "Operations Officer");
  assert.ok(session.user.permissions.includes("bag.tag"));
});

test("database mocks are scripted, observable, and reset after a test", async (t) => {
  const context = createTestContext(t, {
    database: {
      initialData: { bags: [{ id: "ETB-P1-001" }] },
      repositories: {
        bags: { findById: async (id) => ({ id }) },
      },
    },
  });
  assert.deepEqual(await context.database.bags.findById("ETB-P1-001"), { id: "ETB-P1-001" });
  assert.equal(context.database.bags.findById.calls.length, 1);
  context.database.state.bags.push({ id: "ETB-P1-002" });
  context.reset();
  assert.equal(context.database.bags.findById.calls.length, 0);
  assert.deepEqual(context.database.state.bags, [{ id: "ETB-P1-001" }]);
});

test("integration mocks collect BHS, HBSS, RFID, printer, GPIO, bus, and WebSocket activity", async (t) => {
  const context = createTestContext(t);
  const reads = [];
  context.rfidReader.subscribe((read) => reads.push(read));
  await context.rfidReader.emitRead(createRfidEvent());
  const acknowledgement = await context.bhs.receive();
  const scan = await context.hbss.getScanByBhsUid("BHS0000001");
  await context.rfidPrinter.printTag({ jobId: "PRINT-P1-009" });
  await context.gpio.activate("CUSTOMS_EXIT_ALARM");
  await context.messageBus.publish("bag.updated", { bagId: "ETB-P1-003" });
  context.websocket.collect("bag.updated", { bagId: "ETB-P1-003" });

  assert.equal(reads.length, 1);
  assert.equal(acknowledgement.messageType, 2002);
  assert.equal(scan.bhsUid, "BHS0000001");
  assert.equal(context.rfidPrinter.printTag.calls.length, 1);
  assert.equal(context.gpio.activate.calls.length, 1);
  assert.equal(context.messageBus.messages.length, 1);
  assert.equal(context.websocket.byType("bag.updated").length, 1);
});

test("audit and domain-error assertions report exact expected properties", async () => {
  const event = expectAuditEvent(
    [{ action: "BAG_TAGGED", outcome: "SUCCESS", metadata: { previousStatus: "IDENTIFIED" } }],
    { action: "BAG_TAGGED", metadata: { previousStatus: "IDENTIFIED" } },
  );
  assert.equal(event.outcome, "SUCCESS");

  const error = Object.assign(new Error("Bag transition rejected"), { code: "INVALID_TRANSITION" });
  assert.equal(
    await expectDomainError(
      async () => {
        throw error;
      },
      { code: "INVALID_TRANSITION", message: /transition rejected/ },
    ),
    error,
  );
});
