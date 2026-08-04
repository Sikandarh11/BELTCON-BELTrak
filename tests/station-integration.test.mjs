import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProjectModuleLoader } from "./helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
test.after(() => loader.close());

const [
  codec,
  transportModule,
  repositoryModule,
  agentModule,
  simulatorModule,
  configModule,
  security,
  faultApiModule,
  fatHarnessModule,
] = await Promise.all([
  loader.load("/src/services/stations/bhs/bhsWireCodec.ts"),
  loader.load("/src/services/stations/bhs/bhsStationTransport.ts"),
  loader.load("/src/services/stations/bhs/stationInboxRepository.server.ts"),
  loader.load("/src/services/stations/bhs/taggingStationAgent.server.ts"),
  loader.load("/src/services/stations/bhs/bhsPlcSimulator.ts"),
  loader.load("/src/services/stations/stationConfig.ts"),
  loader.load("/src/services/stations/integrationHarnessSecurity.ts"),
  loader.load("/src/services/stations/stationFaultConsoleApi.server.ts"),
  loader.load("/src/services/stations/softwareFatHarness.server.ts"),
]);

const {
  decodeBhsWireMessage2001,
  decodeBhsWireMessage2001Burst,
  encodeBhsWireAcknowledgement2002Payload,
  encodeBhsWireMessage2001,
} = codec;
const { LoopbackBhsStationTransport, ProfinetBhsStationTransport, SimulatedBhsStationTransport } =
  transportModule;
const { SqliteStationInboxRepository } = repositoryModule;
const { DefaultTaggingStationAgent } = agentModule;
const { BhsPlcSimulator } = simulatorModule;
const { taggingStationConfigSchema, validateUniqueStationRouting } = configModule;

const message = (overrides = {}) => ({
  messageType: 2001,
  trigger: 1,
  lineId: "01",
  bhsUid: "0012345678",
  evaluation: "R",
  ...overrides,
});

const stationConfig = (overrides = {}) =>
  taggingStationConfigSchema.parse({
    stationId: "TAG-STATION-01",
    siteId: "ALWAJH",
    allowedLineIds: ["01"],
    centralServerUrl: "http://127.0.0.1:3000",
    centralSourceSystem: "ALWAJH_TAG_STATION_01",
    transportType: "SIMULATED",
    acknowledgementEnabled: true,
    acknowledgementReceivedValue: 1,
    acknowledgementMappingStatus: "PENDING_VENDOR_CONFIRMATION",
    acknowledgeQueueCapacityReached: false,
    physicalMappingStatus: "SIMULATED",
    localPersistencePath: "unused.sqlite",
    retentionDays: 90,
    ...overrides,
  });

async function createHarness(options = {}) {
  const directory = options.directory ?? (await mkdtemp(path.join(os.tmpdir(), "sbts-station-")));
  const databasePath = path.join(directory, "station.sqlite");
  const config = stationConfig({ localPersistencePath: databasePath, ...options.config });
  const repository = new SqliteStationInboxRepository(
    databasePath,
    config.stationId,
    config.siteId,
  );
  const transport = options.transport ?? new SimulatedBhsStationTransport();
  const calls = [];
  const central = {
    unavailable: Boolean(options.centralUnavailable),
    async ingest(value, context) {
      calls.push({ message: structuredClone(value), context: structuredClone(context) });
      if (this.unavailable) throw new Error("https://user:secret@central.invalid key=hidden");
      return { outcome: "ACCEPTED", bagId: `ETB-${value.bhsUid}` };
    },
  };
  const agent = new DefaultTaggingStationAgent({
    config,
    transport,
    repository,
    centralClient: central,
  });
  return {
    directory,
    databasePath,
    config,
    repository,
    transport,
    central,
    calls,
    agent,
    async close({ keepDirectory = false } = {}) {
      await agent.stop();
      repository.close();
      if (!keepDirectory) await rm(directory, { recursive: true, force: true });
    },
  };
}

const tagger = { id: "operator-1", permissions: new Set(["bag.tag"]) };
const supervisor = {
  id: "supervisor-1",
  permissions: new Set(["bag.tag", "station.jam.clear", "station.sync.retry"]),
};

test("P2-STATION-001 BHS transport abstraction", async (t) => {
  await t.test(
    "lifecycle, health, receive, disconnect, reconnect and shutdown are deterministic",
    async () => {
      const transport = new SimulatedBhsStationTransport();
      const controller = new AbortController();
      let deliveries = 0;
      transport.onBagMessage(() => deliveries++);
      await transport.start(controller.signal);
      await transport.start(controller.signal);
      assert.equal((await transport.getHealth()).state, "ONLINE");
      await transport.emitFrame(encodeBhsWireMessage2001(message()));
      assert.equal(deliveries, 1);
      transport.disconnect();
      assert.equal((await transport.getHealth()).state, "OFFLINE");
      await assert.rejects(() => transport.emitFrame(new Uint8Array(14)), /stopped/i);
      transport.reconnect();
      controller.abort();
      assert.equal((await transport.getHealth()).state, "STOPPED");
      await transport.stop();
      await transport.stop();
    },
  );
  await t.test("handler failure degrades transport without preventing other handlers", async () => {
    const transport = new SimulatedBhsStationTransport();
    await transport.start(new AbortController().signal);
    let delivered = false;
    transport.onBagMessage(() => {
      throw new Error("handler failed");
    });
    transport.onBagMessage(() => (delivered = true));
    const result = await transport.emitFrame(encodeBhsWireMessage2001(message()));
    assert.deepEqual(result, { delivered: 2, handlerErrors: 1 });
    assert.equal(delivered, true);
    assert.equal((await transport.getHealth()).state, "DEGRADED");
  });
  await t.test("unavailable Profinet shell never claims hardware support", async () => {
    const transport = new ProfinetBhsStationTransport();
    await assert.rejects(
      () => transport.start(new AbortController().signal),
      (error) => {
        assert.equal(error.code, "PROFINET_ADAPTER_UNAVAILABLE");
        return true;
      },
    );
    assert.equal((await transport.getHealth()).state, "MISCONFIGURED");
  });
});

test("P2-STATION-002 Message 2001 decoder", () => {
  for (const evaluation of ["A", "R", "T", "N", "?"]) {
    const original = message({ evaluation });
    const decoded = decodeBhsWireMessage2001(encodeBhsWireMessage2001(original));
    assert.equal(decoded.evaluation, evaluation);
    assert.equal(decoded.bhsUid, original.bhsUid);
    assert.equal(decoded.lineId, "01");
  }
  assert.equal(
    decodeBhsWireMessage2001(encodeBhsWireMessage2001(message({ bhsUid: "AB12CD3456" }))).bhsUid,
    "AB12CD3456",
  );
  const burst = new Uint8Array(28);
  burst.set(encodeBhsWireMessage2001(message()), 0);
  burst.set(encodeBhsWireMessage2001(message({ bhsUid: "0098765432" })), 14);
  assert.deepEqual(
    decodeBhsWireMessage2001Burst(burst).map((item) => item.bhsUid),
    ["0012345678", "0098765432"],
  );
});

test("P2-STATION-003 Invalid message rejection", async () => {
  const invalidFrames = [];
  const valid = encodeBhsWireMessage2001(message());
  invalidFrames.push(valid.slice(0, 13), new Uint8Array(15));
  const trigger = Uint8Array.from(valid);
  trigger[0] = 2;
  invalidFrames.push(trigger);
  const nonAsciiBag = Uint8Array.from(valid);
  nonAsciiBag[5] = 0xff;
  invalidFrames.push(nonAsciiBag);
  const nullBag = Uint8Array.from(valid);
  nullBag[6] = 0;
  invalidFrames.push(nullBag);
  const controlLine = Uint8Array.from(valid);
  controlLine[1] = 0x1f;
  invalidFrames.push(controlLine);
  const evaluation = Uint8Array.from(valid);
  evaluation[13] = "X".charCodeAt(0);
  invalidFrames.push(evaluation);
  for (const frame of invalidFrames) assert.throws(() => decodeBhsWireMessage2001(frame));
  for (const invalid of [
    message({ lineId: "1" }),
    message({ lineId: "001" }),
    message({ bhsUid: "123456789" }),
    message({ bhsUid: "12345678901" }),
    message({ bhsUid: "" }),
  ]) {
    assert.throws(() => encodeBhsWireMessage2001(invalid));
  }

  const harness = await createHarness();
  await harness.agent.start();
  for (const frame of invalidFrames) {
    const result = await harness.agent.receiveBhsMessage(frame);
    assert.equal(result.outcome, "REJECTED");
  }
  assert.deepEqual(await harness.agent.getQueue(), {
    position1: null,
    position2: null,
    alarms: [],
  });
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.transport.acknowledgements.length, 0);
  await harness.close();
});

test("P2-STATION-004 Message 2002 encoder", () => {
  const payload = encodeBhsWireAcknowledgement2002Payload({
    messageType: 2002,
    ack: 7,
    bhsUid: "0012345678",
    mappingStatus: "PENDING_VENDOR_CONFIRMATION",
  });
  assert.equal(payload.length, 11);
  assert.equal(payload[0], 7);
  assert.equal(Buffer.from(payload.subarray(1)).toString("ascii"), "0012345678");
  assert.throws(() =>
    encodeBhsWireAcknowledgement2002Payload({
      messageType: 2002,
      ack: 256,
      bhsUid: "0012345678",
      mappingStatus: "PENDING_VENDOR_CONFIRMATION",
    }),
  );
});

test("P2-STATION-005 Optional acknowledgement disabled", async () => {
  const harness = await createHarness({
    config: { acknowledgementEnabled: false, acknowledgementReceivedValue: null },
  });
  await harness.agent.start();
  const result = await harness.agent.receiveBhsMessage(message());
  assert.equal(result.acknowledgement, "DISABLED");
  assert.equal(harness.transport.acknowledgements.length, 0);
  await harness.close();
});

test("P2-STATION-006 Durable-before-ack behavior", async () => {
  const harness = await createHarness();
  let queueWasDurable = false;
  const original = harness.transport.sendAcknowledgement.bind(harness.transport);
  harness.transport.sendAcknowledgement = async (ack) => {
    queueWasDurable = Boolean((await harness.repository.loadQueue()).position1);
    return original(ack);
  };
  await harness.agent.start();
  const result = await harness.agent.receiveBhsMessage(message());
  assert.equal(queueWasDurable, true);
  assert.equal(result.acknowledgement, "SENT");
  const failedRepository = {
    ...harness.repository,
    saveInboundMessage: async () => {
      throw new Error("disk full");
    },
  };
  const failedAgent = new DefaultTaggingStationAgent({
    config: harness.config,
    transport: harness.transport,
    repository: failedRepository,
    centralClient: harness.central,
  });
  const failed = await failedAgent.receiveBhsMessage(message({ bhsUid: "0099999999" }));
  assert.equal(failed.errorCode, "STATION_DURABLE_SAVE_FAILED");
  assert.equal(harness.transport.acknowledgements.length, 1);
  await harness.close();
});

test("P2-STATION-007 First queue position", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  await harness.agent.receiveBhsMessage(message());
  const queue = await harness.agent.getQueue();
  assert.equal(queue.position1.bhsUid, "0012345678");
  assert.equal(queue.position1.state, "ACTIVE");
  assert.equal(queue.position2, null);
  await harness.close();
});

test("P2-STATION-008 Second queue position", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  await harness.agent.receiveBhsMessage(message());
  await harness.agent.receiveBhsMessage(message({ bhsUid: "0022345678" }));
  const queue = await harness.agent.getQueue();
  assert.equal(queue.position1.position, 1);
  assert.equal(queue.position2.position, 2);
  assert.equal(queue.position2.state, "WAITING");
  await harness.close();
});

test("P2-STATION-009 Queue capacity reached", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  await harness.agent.receiveBhsMessage(message());
  await harness.agent.receiveBhsMessage(message({ bhsUid: "0022345678" }));
  const result = await harness.agent.receiveBhsMessage(message({ bhsUid: "0032345678" }));
  assert.equal(result.outcome, "QUEUE_CAPACITY_REACHED");
  assert.equal(result.inboundMessageId !== null, true);
  assert.equal(result.queueItemId, null);
  assert.equal(result.acknowledgement, "NOT_SENT");
  const queue = await harness.agent.getQueue();
  assert.equal(queue.position1.bhsUid, "0012345678");
  assert.equal(queue.position2.bhsUid, "0022345678");
  assert.equal(
    queue.alarms.some((alarm) => alarm.code === "QUEUE_CAPACITY_REACHED"),
    true,
  );
  await harness.close();
});

test("P2-STATION-010 Queue advancement", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  await harness.agent.receiveBhsMessage(message());
  await harness.agent.receiveBhsMessage(message({ bhsUid: "0022345678" }));
  const initial = await harness.agent.getQueue();
  await harness.agent.startTagging(initial.position1.id, tagger);
  const centralSessionId = "11111111-1111-4111-8111-111111111111";
  const centralAssignmentId = "22222222-2222-4222-8222-222222222222";
  await harness.agent.bindTaggingSession(initial.position1.id, centralSessionId, tagger);
  await harness.agent.completeTagging(
    initial.position1.id,
    centralSessionId,
    centralAssignmentId,
    tagger,
  );
  const advanced = await harness.agent.getQueue();
  assert.equal(advanced.position1.bhsUid, "0022345678");
  assert.equal(advanced.position1.state, "ACTIVE");
  assert.equal(advanced.position2, null);
  await harness.close();
});

test("P2-STATION-011 Manual jam clear", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  await harness.agent.receiveBhsMessage(message());
  await harness.agent.receiveBhsMessage(message({ bhsUid: "0022345678" }));
  const initial = await harness.agent.getQueue();
  await harness.repository.jamActive(initial.position1.id, "simulated jam");
  await assert.rejects(
    () => harness.agent.clearJammedBag(initial.position1.id, "clear", tagger),
    /UNAUTHORIZED/,
  );
  await harness.agent.clearJammedBag(initial.position1.id, "approved clear", supervisor);
  assert.equal((await harness.agent.getQueue()).position1.bhsUid, "0022345678");
  await harness.close();
});

test("P2-STATION-012 Station routing", async () => {
  const harness = await createHarness({ config: { allowedLineIds: ["01", "02"] } });
  await harness.agent.start();
  assert.equal(
    (await harness.agent.receiveBhsMessage(message({ lineId: "02" }))).outcome,
    "ACCEPTED",
  );
  assert.equal(
    (await harness.agent.receiveBhsMessage(message({ lineId: "99", bhsUid: "0099999999" })))
      .errorCode,
    "BHS_LINE_NOT_ASSIGNED_TO_STATION",
  );
  assert.throws(() =>
    validateUniqueStationRouting([stationConfig(), stationConfig({ stationId: "TAG-STATION-02" })]),
  );
  await harness.close();
});

test("P2-STATION-013 Local durable persistence", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  const accepted = await harness.agent.receiveBhsMessage(message());
  const acceptedWithoutQueue = await harness.agent.receiveBhsMessage(
    message({ bhsUid: "0098765432", evaluation: "A" }),
  );
  assert.equal(
    await harness.repository.cleanupRetained(new Date(Date.now() + 1_000).toISOString()),
    1,
  );
  const receivedAfterRetention = await harness.agent.receiveBhsMessage(
    message({ bhsUid: "0098765432", evaluation: "A" }),
  );
  assert.notEqual(receivedAfterRetention.inboundMessageId, acceptedWithoutQueue.inboundMessageId);
  await harness.close({ keepDirectory: true });
  const restored = await createHarness({ directory: harness.directory });
  const queue = await restored.repository.loadQueue();
  assert.equal(queue.position1.bhsUid, "0012345678");
  const duplicate = await restored.agent.receiveBhsMessage(message());
  assert.equal(duplicate.outcome, "DUPLICATE");
  assert.equal(duplicate.inboundMessageId, accepted.inboundMessageId);
  restored.repository.close();
  await rm(harness.directory, { recursive: true, force: true });

  const corruptDirectory = await mkdtemp(path.join(os.tmpdir(), "sbts-corrupt-"));
  const corruptPath = path.join(corruptDirectory, "station.sqlite");
  await writeFile(corruptPath, "not a sqlite database", "utf8");
  assert.throws(() => new SqliteStationInboxRepository(corruptPath, "TAG-STATION-01", "ALWAJH"));
  await rm(corruptDirectory, { recursive: true, force: true });
});

test("P2-STATION-014 Central synchronization", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  const result = await harness.agent.receiveBhsMessage(message());
  assert.equal(result.synchronization, "SYNCED");
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].context.stationId, "TAG-STATION-01");
  assert.equal(harness.calls[0].context.siteId, "ALWAJH");
  await harness.close();
});

test("P2-STATION-015 Offline synchronization", async () => {
  const harness = await createHarness({ centralUnavailable: true });
  await harness.agent.start();
  const result = await harness.agent.receiveBhsMessage(message());
  assert.equal(result.outcome, "ACCEPTED");
  assert.equal(result.synchronization, "PENDING");
  assert.equal((await harness.agent.getHealth()).state, "DEGRADED");
  harness.central.unavailable = false;
  await harness.agent.retrySynchronization(null, supervisor);
  assert.equal((await harness.repository.loadPendingSynchronization()).length, 0);
  await harness.close();
});

test("P2-STATION-016 Restart recovery", async () => {
  const harness = await createHarness({ centralUnavailable: true });
  await harness.agent.start();
  harness.transport.faults.acknowledgementWriteFails = true;
  await harness.agent.receiveBhsMessage(message());
  assert.equal((await harness.repository.loadPendingAcknowledgements()).length, 1);
  harness.transport.disconnect();
  harness.transport.faults.acknowledgementWriteFails = false;
  harness.transport.reconnect();
  await harness.agent.retryAcknowledgements();
  assert.equal((await harness.repository.loadPendingAcknowledgements()).length, 0);
  assert.equal(harness.transport.acknowledgements.length, 1);
  await harness.agent.retryAcknowledgements();
  assert.equal(harness.transport.acknowledgements.length, 1);
  harness.transport.faults.acknowledgementWriteFails = true;
  await harness.agent.receiveBhsMessage(message({ bhsUid: "0022345678" }));
  await harness.close({ keepDirectory: true });
  const restored = await createHarness({ directory: harness.directory });
  restored.transport.faults.acknowledgementWriteFails = false;
  await restored.agent.start();
  assert.equal((await restored.repository.loadPendingAcknowledgements()).length, 0);
  assert.equal((await restored.repository.loadPendingSynchronization()).length, 0);
  assert.equal((await restored.agent.getQueue()).position1.bhsUid, "0012345678");
  await restored.close();
});

test("P2-STATION-017 Simulator production disable", () => {
  assert.equal(security.isSoftwareSimulatorEnabled("production", true), false);
  assert.equal(security.isSoftwareSimulatorEnabled("development", false), false);
  assert.equal(security.isSoftwareSimulatorEnabled("test", true), true);
});

test("software FAT API is production-disabled and permission protected", async () => {
  let harnessRequested = false;
  const production = await faultApiModule.handleStationFaultConsoleRequest(
    new Request("http://localhost/api/dev/simulator/station-harness"),
    {
      environment: "production",
      enabled: true,
      getHarness: async () => {
        harnessRequested = true;
        return {};
      },
    },
  );
  assert.equal(production.status, 403);
  assert.equal(harnessRequested, false);
  const unauthenticated = await faultApiModule.handleStationFaultConsoleRequest(
    new Request("http://localhost/api/dev/simulator/station-harness"),
    { environment: "test", enabled: true, getSession: async () => null },
  );
  assert.equal(unauthenticated.status, 401);
  const forbidden = await faultApiModule.handleStationFaultConsoleRequest(
    new Request("http://localhost/api/dev/simulator/station-harness"),
    {
      environment: "test",
      enabled: true,
      getSession: async () => ({ user: { id: "user" } }),
      requirePermission: async (_session, permission) => {
        if (permission === "simulator.use") throw new Error("denied");
      },
    },
  );
  assert.equal(forbidden.status, 403);
});

test("P2-STATION-018 Station security", async () => {
  const harness = await createHarness({ centralUnavailable: true });
  await harness.agent.start();
  await harness.agent.receiveBhsMessage(message());
  await assert.rejects(() => harness.agent.retrySynchronization(null, tagger), /UNAUTHORIZED/);
  const database = await readFile(harness.databasePath);
  assert.equal(database.includes(Buffer.from("user:secret")), false);
  const safe = security.sanitizeScenarioExport({
    integrationKey: "secret",
    nested: { token: "x", ok: 1 },
  });
  assert.deepEqual(safe, { integrationKey: "[REDACTED]", nested: { token: "[REDACTED]", ok: 1 } });
  assert.doesNotMatch(
    security.sanitizeIntegrationError(new Error("https://user:secret@host/db key=abc")),
    /secret|abc/,
  );
  await harness.close();
});

test("P2-STATION-019 Concurrent inbound messages", async () => {
  const harness = await createHarness();
  await harness.agent.start();
  const results = await Promise.all([
    harness.agent.receiveBhsMessage(message()),
    harness.agent.receiveBhsMessage(message({ bhsUid: "0022345678" })),
    harness.agent.receiveBhsMessage(message({ bhsUid: "0032345678" })),
  ]);
  assert.equal(results.filter((result) => result.outcome === "ACCEPTED").length, 2);
  assert.equal(results.filter((result) => result.outcome === "QUEUE_CAPACITY_REACHED").length, 1);
  const queue = await harness.agent.getQueue();
  assert.equal(queue.position1 !== null && queue.position2 !== null, true);
  await harness.close();
});

test("P2-STATION-020 Software load", async () => {
  const harness = await createHarness({
    config: { acknowledgementEnabled: false, acknowledgementReceivedValue: null },
  });
  await harness.agent.start();
  const values = Array.from({ length: 100 }, (_, index) =>
    message({ bhsUid: String(index).padStart(10, "0") }),
  );
  const results = [];
  for (const value of values) results.push(await harness.agent.receiveBhsMessage(value));
  assert.equal(results.length, 100);
  assert.equal(results.filter((result) => result.outcome === "ACCEPTED").length, 2);
  assert.equal(results.filter((result) => result.outcome === "QUEUE_CAPACITY_REACHED").length, 98);
  assert.equal(harness.calls.length, 100);
  const duplicate = await Promise.all(
    values.slice(0, 50).map((value) => harness.agent.receiveBhsMessage(value)),
  );
  assert.equal(
    duplicate.every((result) => result.outcome === "DUPLICATE"),
    true,
  );
  const concurrent = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      harness.agent.receiveBhsMessage(
        message({ bhsUid: String(index + 1000).padStart(10, "0"), evaluation: "A" }),
      ),
    ),
  );
  assert.equal(
    concurrent.every((result) => result.outcome === "NOT_QUEUED"),
    true,
  );
  assert.equal((await harness.agent.getQueue()).position2 !== null, true);

  const loopback = new LoopbackBhsStationTransport();
  const observed = [];
  loopback.onAcknowledgement((ack) => observed.push(ack.bhsUid));
  await loopback.start(new AbortController().signal);
  await loopback.sendAcknowledgement({
    messageType: 2002,
    ack: 1,
    bhsUid: "0012345678",
    mappingStatus: "PENDING_VENDOR_CONFIRMATION",
  });
  assert.deepEqual(observed, ["0012345678"]);

  const simulator = new BhsPlcSimulator(harness.transport);
  await simulator.send(message({ evaluation: "A", bhsUid: "9999999999" }), { duplicateCount: 2 });
  assert.equal(harness.calls.at(-1).message.evaluation, "A");
  await harness.close();

  const offline = await createHarness({
    centralUnavailable: true,
    config: { acknowledgementEnabled: false, acknowledgementReceivedValue: null },
  });
  await offline.agent.start();
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      offline.agent.receiveBhsMessage(
        message({ bhsUid: String(index + 2000).padStart(10, "0"), evaluation: "A" }),
      ),
    ),
  );
  assert.equal((await offline.repository.loadPendingSynchronization()).length, 20);
  offline.central.unavailable = false;
  await offline.agent.retrySynchronization(null, supervisor);
  assert.equal((await offline.repository.loadPendingSynchronization()).length, 0);
  await offline.close();
});

test("unified software FAT harness crosses both station transport boundaries", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sbts-station-fat-"));
  const fat = await fatHarnessModule.SoftwareFatHarness.create(
    path.join(directory, "software-fat.sqlite"),
  );
  const bhs = await fat.execute({ action: "BHS_SEND", message: message(), repeat: 1 });
  assert.equal(bhs.simulation, true);
  assert.equal(bhs.bhs.queue.position1.bhsUid, "0012345678");
  const hbss = await fat.execute({
    action: "HBSS_SCAN",
    requestId: "fat-hbss-1",
    barcode: "RFID-FAT-1",
    bhsUid: "0012345678",
  });
  assert.equal(hbss.hbss.health.requests.at(-1).state, "REQUEST_SENT");
  assert.equal(hbss.hbss.transmittedBytesHex.at(-1), "02303031323334353637380d0a");
  await fat.execute({ action: "BHS_CENTRAL_FAULT", fault: "UNAVAILABLE" });
  assert.equal((await fat.snapshot()).injectedFaults.at(-1).code, "BHS_CENTRAL_FAULT");
  await fat.shutdown();
  await rm(directory, { recursive: true, force: true });
});
