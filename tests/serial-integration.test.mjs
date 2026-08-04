import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProjectModuleLoader } from "./helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
test.after(() => loader.close());

const [
  codec,
  serialModule,
  barcodeModule,
  repositoryModule,
  agentModule,
  configModule,
  security,
  stationApi,
  stationRuntime,
] = await Promise.all([
  loader.load("/src/services/stations/hbss/hbssBidCodec.ts"),
  loader.load("/src/services/stations/hbss/hbssSerialAdapter.ts"),
  loader.load("/src/services/stations/hbss/barcodeInputAdapter.ts"),
  loader.load("/src/services/stations/hbss/recheckStationRepository.server.ts"),
  loader.load("/src/services/stations/hbss/recheckStationAgent.server.ts"),
  loader.load("/src/services/stations/stationConfig.ts"),
  loader.load("/src/services/stations/integrationHarnessSecurity.ts"),
  loader.load("/src/services/stations/hbss/recheckStationApi.server.ts"),
  loader.load("/src/services/stations/hbss/recheckStationRuntime.server.ts"),
]);

const { encodeHbssBidRequest } = codec;
const {
  HbssSerialError,
  LoopbackHbssSerialAdapter,
  PhysicalRs232Adapter,
  REQUIRED_HBSS_SERIAL_CONFIGURATION,
  VirtualHbssSerialAdapter,
} = serialModule;
const { KeyboardWedgeBarcodeInputAdapter, SimulatedBarcodeInputAdapter } = barcodeModule;
const { SqliteRecheckStationRepository } = repositoryModule;
const { RecheckStationAgent, isHbssErrorDialogVisible } = agentModule;
const { readRecheckStationConfig, recheckStationConfigSchema } = configModule;

const serialConfiguration = {
  binding: "VIRTUAL-HBSS-01",
  ...REQUIRED_HBSS_SERIAL_CONFIGURATION,
};
const recheckConfig = (overrides = {}) =>
  recheckStationConfigSchema.parse({
    stationId: "RECHECK-STATION-01",
    siteId: "ALWAJH",
    serialBinding: "VIRTUAL-HBSS-01",
    serialAdapterType: "VIRTUAL",
    framingProfile: "STX_BAGID_CRLF",
    framingMappingStatus: "PENDING_VENDOR_CONFIRMATION",
    localPersistencePath: "unused.sqlite",
    errorDialogTimeoutMs: 5000,
    duplicateScanDebounceMs: 1000,
    serialSettings: REQUIRED_HBSS_SERIAL_CONFIGURATION,
    ...overrides,
  });

const recheckActor = { id: "officer-1", permissions: new Set(["bag.recheck"]) };
const retryActor = {
  id: "supervisor-1",
  permissions: new Set(["bag.recheck", "station.recall.retry"]),
};

const lookupFor = (barcode, overrides = {}) => ({
  bagId: `ETB-${barcode}`,
  bhsUid: "0012345678",
  rfidTagBarcode: barcode,
  status: "AT_RECHECK",
  assignedRecheckStationId: "RECHECK-STATION-01",
  ...overrides,
});

const noTimeoutTimer = {
  createTimeout() {
    return { promise: new Promise(() => undefined), cancel() {} };
  },
};

const immediateTimeoutTimer = {
  createTimeout(_milliseconds, code) {
    return {
      promise: Promise.reject(new HbssSerialError("fake timer expired", code)),
      cancel() {},
    };
  },
};

async function createHarness(options = {}) {
  const directory = options.directory ?? (await mkdtemp(path.join(os.tmpdir(), "sbts-serial-")));
  const databasePath = path.join(directory, "recheck.sqlite");
  const config = recheckConfig({ localPersistencePath: databasePath, ...options.config });
  const repository = new SqliteRecheckStationRepository(
    databasePath,
    config.stationId,
    config.siteId,
  );
  const serial =
    options.serial ??
    new VirtualHbssSerialAdapter({
      binding: config.serialBinding,
      ...config.serialSettings,
    });
  const barcode = options.barcode ?? new SimulatedBarcodeInputAdapter();
  const lookups = [];
  const central = options.central ?? {
    async findByExactTag(value) {
      lookups.push(value);
      return lookupFor(value, options.lookupOverrides);
    },
  };
  const agent = new RecheckStationAgent({
    config,
    serialAdapter: serial,
    barcodeAdapter: barcode,
    repository,
    centralClient: central,
    timer: options.timer ?? noTimeoutTimer,
  });
  return {
    directory,
    databasePath,
    config,
    repository,
    serial,
    barcode,
    central,
    lookups,
    agent,
    async close({ keepDirectory = false } = {}) {
      await agent.stop();
      repository.close();
      if (!keepDirectory) await rm(directory, { recursive: true, force: true });
    },
  };
}

function recallInput(index = 1, overrides = {}) {
  return {
    requestId: `serial-request-${String(index).padStart(4, "0")}`,
    barcode: `RFID-${String(index).padStart(6, "0")}`,
    actor: recheckActor,
    ...overrides,
  };
}

test("P2-SERIAL-001 Serial adapter abstraction", async () => {
  const adapter = new VirtualHbssSerialAdapter(serialConfiguration);
  assert.equal((await adapter.getHealth()).state, "STOPPED");
  await adapter.open();
  assert.equal((await adapter.getHealth()).state, "ONLINE");
  const write = await adapter.write(Uint8Array.of(1, 2, 3));
  assert.equal(write.bytesWritten, 3);
  await adapter.close();
  assert.equal((await adapter.getHealth()).state, "STOPPED");
  const physical = new PhysicalRs232Adapter("COM-UNCONFIRMED");
  await assert.rejects(
    () => physical.open(),
    (error) => {
      assert.equal(error.code, "HBSS_RS232_ADAPTER_UNAVAILABLE");
      return true;
    },
  );
  assert.equal((await physical.getHealth()).state, "MISCONFIGURED");
});

test("P2-SERIAL-002 Serial configuration", () => {
  assert.deepEqual(REQUIRED_HBSS_SERIAL_CONFIGURATION, {
    encoding: "ASCII",
    baudRate: 9600,
    parity: "EVEN",
    dataBits: 8,
    stopBits: 1,
    flowControl: "NONE",
  });
  const parsed = readRecheckStationConfig({
    HBSS_RECHECK_STATION_ID: "RECHECK-STATION-01",
    HBSS_RECHECK_SITE_ID: "ALWAJH",
    HBSS_SERIAL_BINDING: "VIRTUAL-HBSS-01",
    HBSS_SERIAL_ADAPTER: "VIRTUAL",
    HBSS_BID_FRAMING_PROFILE: "STX_BAGID_CRLF",
    HBSS_RECHECK_LOCAL_DB_PATH: "station.sqlite",
  });
  assert.equal(parsed.errorDialogTimeoutMs, 5000);
  assert.throws(() =>
    recheckStationConfig({
      serialSettings: { ...REQUIRED_HBSS_SERIAL_CONFIGURATION, baudRate: 4800 },
    }),
  );
});

test("P2-SERIAL-003 STX BagID CR LF encoding", () => {
  const bytes = encodeHbssBidRequest("0012345678", "STX_BAGID_CRLF");
  assert.equal(bytes.length, 13);
  assert.deepEqual([...bytes], [2, 48, 48, 49, 50, 51, 52, 53, 54, 55, 56, 13, 10]);
});

test("P2-SERIAL-004 ASCII-only encoding", () => {
  assert.equal(
    Buffer.from(encodeHbssBidRequest("AB12CD3456", "ASCII_BAGID_ONLY")).toString("ascii"),
    "AB12CD3456",
  );
  assert.throws(
    () => encodeHbssBidRequest("0012345678", "VENDOR_CONFIRMED"),
    (error) => error.code === "HBSS_VENDOR_FRAMING_UNAVAILABLE",
  );
});

test("P2-SERIAL-005 Invalid BagID rejection", () => {
  for (const value of ["", "123456789", "12345678901", "ETB-123456", "1234\u000056789"]) {
    assert.throws(() => encodeHbssBidRequest(value, "STX_BAGID_CRLF"));
  }
});

test("P2-SERIAL-006 Exact byte preservation", () => {
  const leading = encodeHbssBidRequest("0000000001", "ASCII_BAGID_ONLY");
  const alpha = encodeHbssBidRequest("A0B1C2D3E4", "ASCII_BAGID_ONLY");
  assert.equal(Buffer.from(leading).toString("ascii"), "0000000001");
  assert.equal(Buffer.from(alpha).toString("ascii"), "A0B1C2D3E4");
});

test("P2-SERIAL-007 Virtual serial write", async () => {
  const harness = await createHarness();
  const result = await harness.agent.requestRecall(recallInput());
  assert.equal(result.request.state, "REQUEST_SENT");
  assert.equal(result.duplicate, false);
  assert.equal(Buffer.from(harness.serial.sink[0]).toString("hex"), "02303031323334353637380d0a");
  await harness.close();
});

test("P2-SERIAL-008 Port unavailable", async () => {
  const harness = await createHarness();
  harness.serial.faults.portUnavailable = true;
  const result = await harness.agent.requestRecall(recallInput());
  assert.equal(result.request.state, "UNAVAILABLE");
  assert.equal(result.request.errorCode, "HBSS_SERIAL_PORT_UNAVAILABLE");
  assert.equal(harness.serial.sink.length, 0);
  await harness.close();
});

test("P2-SERIAL-009 Partial write", async () => {
  const harness = await createHarness();
  harness.serial.faults.partialWriteBytes = 4;
  const result = await harness.agent.requestRecall(recallInput());
  assert.equal(result.request.state, "FAILED");
  assert.equal(result.request.errorCode, "HBSS_SERIAL_PARTIAL_WRITE");
  assert.equal(harness.serial.sink[0].length, 4);
  await harness.close();
});

test("P2-SERIAL-010 Five-second timeout", async (t) => {
  await t.test("port open timeout uses fake timer", async () => {
    const harness = await createHarness({ timer: immediateTimeoutTimer });
    harness.serial.faults.openNeverCompletes = true;
    const result = await harness.agent.requestRecall(recallInput());
    assert.equal(result.request.state, "TIMED_OUT");
    assert.equal(result.request.errorCode, "HBSS_SERIAL_OPEN_TIMED_OUT");
    assert.equal(result.operatorFeedbackTimeoutMs, 5000);
    await harness.close();
  });
  await t.test("completed write does not wait for a response telegram", async () => {
    const harness = await createHarness();
    const result = await harness.agent.requestRecall(recallInput());
    assert.equal(result.request.state, "REQUEST_SENT");
    assert.equal(isHbssErrorDialogVisible(0, 4999, 5000), true);
    assert.equal(isHbssErrorDialogVisible(0, 5000, 5000), false);
    await harness.close();
  });
});

test("P2-SERIAL-011 Late-result protection", async () => {
  let resolveWrite;
  let rejectTimeout;
  let timeoutCall = 0;
  const timer = {
    createTimeout(_milliseconds, code) {
      timeoutCall++;
      if (timeoutCall === 1) return noTimeoutTimer.createTimeout();
      return {
        promise: new Promise((_, reject) => {
          rejectTimeout = () => reject(new HbssSerialError("fake timeout", code));
        }),
        cancel() {},
      };
    },
  };
  const serial = new VirtualHbssSerialAdapter(serialConfiguration);
  serial.write = () =>
    new Promise((resolve) => {
      resolveWrite = resolve;
    });
  const harness = await createHarness({ timer, serial });
  const pending = harness.agent.requestRecall(recallInput());
  await new Promise(setImmediate);
  rejectTimeout();
  const result = await pending;
  assert.equal(result.request.state, "TIMED_OUT");
  resolveWrite({ bytesWritten: 13, completedAt: new Date().toISOString() });
  await new Promise(setImmediate);
  assert.equal((await harness.repository.get(result.request.requestId)).state, "TIMED_OUT");
  await harness.close();
});

test("P2-SERIAL-012 Manual retry", async () => {
  let call = 0;
  const timer = {
    createTimeout(_milliseconds, code) {
      call++;
      if (call === 2) {
        return {
          promise: Promise.reject(new HbssSerialError("fake timeout", code)),
          cancel() {},
        };
      }
      return noTimeoutTimer.createTimeout();
    },
  };
  const harness = await createHarness({ timer });
  harness.serial.faults.writeNeverCompletes = true;
  const timedOut = await harness.agent.requestRecall(recallInput());
  assert.equal(timedOut.request.state, "TIMED_OUT");
  harness.serial.faults.writeNeverCompletes = false;
  const retried = await harness.agent.retry(timedOut.request.requestId, retryActor);
  assert.equal(retried.state, "REQUEST_SENT");
  assert.equal(retried.attemptCount, 2);
  await harness.close();
});

test("P2-SERIAL-013 No invented acknowledgement", async () => {
  const adapter = new LoopbackHbssSerialAdapter(serialConfiguration);
  assert.equal("read" in adapter, false);
  assert.equal("onAcknowledgement" in adapter, false);
  const harness = await createHarness({ serial: adapter });
  const result = await harness.agent.requestRecall(recallInput());
  assert.equal(result.request.state, "REQUEST_SENT");
  assert.equal(result.request.errorCode, null);
  await harness.close();
});

test("P2-SERIAL-014 Recall status separation", async () => {
  const harness = await createHarness();
  const result = await harness.agent.requestRecall(recallInput());
  assert.equal(result.request.state, "REQUEST_SENT");
  assert.equal(/ACK|IMAGE|DISPLAY|RETRIEV/.test(result.request.state), false);
  assert.equal(Object.hasOwn(result.request, "imageRetrieved"), false);
  await harness.close();
});

test("P2-SERIAL-015 Barcode scan trigger", async () => {
  const barcode = new SimulatedBarcodeInputAdapter();
  const harness = await createHarness({ barcode });
  await harness.agent.start();
  await barcode.scan("RFID-000001");
  assert.deepEqual(harness.lookups, ["RFID-000001"]);
  assert.equal((await harness.repository.list())[0].state, "REQUEST_SENT");

  const events = [];
  let now = 0;
  const wedge = new KeyboardWedgeBarcodeInputAdapter({
    terminators: new Set(["Enter", "Tab"]),
    maximumScannerInterKeyMs: 50,
    now: () => now,
  });
  wedge.onScan((scan) => events.push(scan));
  await wedge.start();
  for (const key of "ABC") {
    now += 5;
    await wedge.feedKey(key, now);
  }
  await wedge.feedKey("Enter", now + 5);
  for (const key of "XY") {
    now += 100;
    await wedge.feedKey(key, now);
  }
  await wedge.feedKey("Tab", now + 100);
  assert.equal(events[0].value, "ABC");
  assert.equal(events[0].kind, "SCANNER");
  assert.equal(events[1].value, "XY");
  assert.equal(events[1].kind, "MANUAL");
  await wedge.stop();
  await harness.close();
});

test("P2-SERIAL-016 Cross-bag prevention", async () => {
  const harness = await createHarness({
    lookupOverrides: { rfidTagBarcode: "RFID-DIFFERENT", bhsUid: "9999999999" },
  });
  await assert.rejects(() => harness.agent.requestRecall(recallInput()), /EXACT_MATCH_REQUIRED/);
  assert.equal(harness.serial.sink.length, 0);
  assert.equal((await harness.repository.list()).length, 0);
  await harness.close();
});

test("P2-SERIAL-017 Station binding", async () => {
  const harness = await createHarness({
    lookupOverrides: { assignedRecheckStationId: "RECHECK-STATION-02" },
  });
  await assert.rejects(
    () => harness.agent.requestRecall(recallInput()),
    /STATION_BINDING_MISMATCH/,
  );
  assert.equal(harness.serial.sink.length, 0);
  const other = new SqliteRecheckStationRepository(
    harness.databasePath,
    "RECHECK-STATION-02",
    "ALWAJH",
  );
  assert.deepEqual(await other.list(), []);
  other.close();
  await harness.close();
});

test("P2-SERIAL-018 Restart recovery", async () => {
  const harness = await createHarness();
  const created = await harness.repository.create({
    requestId: "restart-writing",
    stationId: harness.config.stationId,
    siteId: harness.config.siteId,
    bagId: "ETB-RESTART",
    bhsUid: "0012345678",
    barcode: "RFID-RESTART",
    rawBarcode: "RFID-RESTART",
    framingProfile: "STX_BAGID_CRLF",
  });
  await harness.repository.transition(created.request.requestId, "VALIDATING");
  await harness.repository.transition(created.request.requestId, "READY_TO_SEND");
  await harness.repository.transition(created.request.requestId, "OPENING_PORT");
  await harness.repository.transition(created.request.requestId, "WRITING");
  await harness.close({ keepDirectory: true });
  const restored = await createHarness({ directory: harness.directory });
  await restored.agent.start();
  const request = await restored.repository.get("restart-writing");
  assert.equal(request.state, "FAILED");
  assert.equal(request.errorCode, "HBSS_AMBIGUOUS_AFTER_RESTART");
  assert.equal(restored.serial.sink.length, 0);
  await restored.close();
});

test("P2-SERIAL-019 Simulator security", () => {
  assert.equal(security.isSoftwareSimulatorEnabled("production", true), false);
  assert.equal(security.isSoftwareSimulatorEnabled("development", true), true);
  const sanitized = security.sanitizeScenarioExport({
    serialBinding: "VIRTUAL",
    clientSecret: "do-not-log",
  });
  assert.deepEqual(sanitized, { serialBinding: "VIRTUAL", clientSecret: "[REDACTED]" });
  assert.throws(() =>
    recheckStationConfig({
      serialAdapterType: "RS232",
      framingProfile: "VENDOR_CONFIRMED",
      framingMappingStatus: "PENDING_VENDOR_CONFIRMATION",
    }),
  );
});

test("Recheck station API security is authenticated, permission-gated and configuration-disabled", async () => {
  await assert.rejects(
    () => stationRuntime.createRecheckStationRuntime({ HBSS_RECHECK_STATION_ENABLED: "false" }),
    (error) => {
      assert.equal(error.code, "HBSS_RECHECK_STATION_AGENT_DISABLED");
      return true;
    },
  );
  const unauthenticated = await stationApi.handleRecheckStationAgentRequest(
    new Request("http://localhost/api/stations/recheck"),
    { getSession: async () => null },
  );
  assert.equal(unauthenticated.status, 401);

  const calls = [];
  const runtime = {
    simulation: true,
    transmittedFrames: () => [Uint8Array.of(0x02, 0x30, 0x0d, 0x0a)],
    agent: {
      requestRecall: async (input) => calls.push(input),
      retry: async () => undefined,
      cancel: async () => undefined,
      getHealth: async () => ({
        state: "ONLINE",
        serial: { state: "ONLINE", binding: "VIRTUAL-HBSS-01" },
        requests: [],
      }),
    },
  };
  const permissions = [];
  const accepted = await stationApi.handleRecheckStationAgentRequest(
    new Request("http://localhost/api/stations/recheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "REQUEST_RECALL",
        requestId: "00000000-0000-4000-8000-000000000701",
        barcode: "RFID-000701",
      }),
    }),
    {
      getSession: async () => ({ user: { id: "officer-1" } }),
      requirePermission: async (_session, permission) => permissions.push(permission),
      getRuntime: async () => runtime,
    },
  );
  assert.equal(accepted.status, 200);
  assert.deepEqual(permissions, ["bag.recheck"]);
  assert.equal(calls[0].barcode, "RFID-000701");
  assert.equal((await accepted.json()).transmittedFramesHex[0], "02300d0a");
});

test("P2-SERIAL-020 Software load", async () => {
  const harness = await createHarness();
  const sequential = [];
  for (let index = 0; index < 100; index++) {
    sequential.push(await harness.agent.requestRecall(recallInput(index + 1)));
  }
  assert.equal(
    sequential.every((result) => result.request.state === "REQUEST_SENT"),
    true,
  );
  assert.equal(harness.serial.sink.length, 100);
  assert.equal(
    harness.serial.sink.every(
      (bytes) => Buffer.from(bytes.subarray(1, 11)).toString("ascii") === "0012345678",
    ),
    true,
  );
  const duplicate = await harness.agent.requestRecall(recallInput(1));
  assert.equal(duplicate.duplicate, true);
  assert.equal(harness.serial.sink.length, 100);
  const concurrent = await Promise.all(
    Array.from({ length: 50 }, (_, index) => recallInput(index + 101)).map((input) =>
      harness.agent.requestRecall(input),
    ),
  );
  assert.equal(
    concurrent.every((result) => result.request.state === "REQUEST_SENT"),
    true,
  );
  assert.equal(harness.serial.sink.length, 150);
  await harness.close();

  const timeoutSerial = new VirtualHbssSerialAdapter(serialConfiguration);
  timeoutSerial.faults.openNeverCompletes = true;
  const timeouts = await createHarness({ timer: immediateTimeoutTimer, serial: timeoutSerial });
  const timeoutResults = [];
  for (let index = 0; index < 100; index++) {
    timeoutResults.push(await timeouts.agent.requestRecall(recallInput(index + 1000)));
  }
  assert.equal(
    timeoutResults.every((result) => result.request.state === "TIMED_OUT"),
    true,
  );
  assert.equal(timeouts.serial.sink.length, 0);
  await timeouts.close();
});
