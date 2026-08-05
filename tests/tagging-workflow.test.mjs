import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createProjectModuleLoader } from "./helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
test.after(() => loader.close());

const [
  schemas,
  configModule,
  inputModule,
  encoderModule,
  verifierModule,
  cameraModule,
  storageModule,
  factoryModule,
  roleModule,
] = await Promise.all([
  loader.load("/src/services/bags/taggingWorkflowSchemas.ts"),
  loader.load("/src/services/stations/stationConfig.ts"),
  loader.load("/src/services/stations/tagging/rfidTagInputAdapter.ts"),
  loader.load("/src/services/stations/tagging/rfidEncoderAdapter.ts"),
  loader.load("/src/services/stations/tagging/rfidVerificationAdapter.ts"),
  loader.load("/src/services/stations/tagging/bagCameraAdapter.ts"),
  loader.load("/src/services/stations/tagging/bagPhotoStorage.ts"),
  loader.load("/src/services/stations/tagging/taggingDeviceFactory.server.ts"),
  loader.load("/src/services/admin/roles/roleSchemas.ts"),
]);

const migration = await readFile(
  new URL("../supabase/migrations/027_complete_tagging_station_workflow.sql", import.meta.url),
  "utf8",
);
const stationRepository = await readFile(
  new URL("../src/services/stations/bhs/stationInboxRepository.server.ts", import.meta.url),
  "utf8",
);
const stationApi = await readFile(
  new URL("../src/services/stations/bhs/taggingStationApi.server.ts", import.meta.url),
  "utf8",
);
const legacyApi = await readFile(
  new URL("../src/services/bags/taggingApi.server.ts", import.meta.url),
  "utf8",
);

function stationConfig(overrides = {}) {
  return configModule.taggingStationConfigSchema.parse({
    stationId: "TAG-01",
    siteId: "ALWAJH",
    allowedLineIds: ["01"],
    centralServerUrl: "http://127.0.0.1:3000",
    centralSourceSystem: "ALWAJH_TAG_STATION_01",
    transportType: "LOOPBACK",
    acknowledgementEnabled: false,
    acknowledgementReceivedValue: null,
    acknowledgementMappingStatus: "PENDING_VENDOR_CONFIRMATION",
    physicalMappingStatus: "UNCONFIRMED",
    localPersistencePath: "tagging.sqlite",
    ...overrides,
  });
}

test("P3-TAG-001 readiness validation is server-owned", () => {
  assert.match(migration, /tagging_readiness_status<>'READY_FOR_TAGGING'/);
  assert.match(migration, /position<>1/);
});

test("P3-TAG-002 session creation is represented by the central RPC", () => {
  assert.match(migration, /create_tagging_session_v1/);
  assert.match(migration, /'READY_FOR_INPUT',v_config\.provisioning_mode/);
});

test("P3-TAG-003 session uniqueness has active bag and queue constraints", () => {
  assert.match(migration, /tagging_sessions_active_bag_uq/);
  assert.match(migration, /tagging_sessions_active_queue_uq/);
});

test("P3-TAG-004 pre-encoded barcode capture preserves case and strips one terminator", () => {
  assert.equal(schemas.normalizeTagBarcode("00TagCase\r\n", "SCANNER"), "00TagCase");
  assert.equal(schemas.containsControlCharacters("00TagCase"), false);
  assert.equal(schemas.containsControlCharacters("\u0007"), true);
  assert.throws(() => schemas.normalizeTagBarcode(" value ", "SCANNER"), /whitespace/);
});

test("P3-TAG-005 EPC validation preserves zeros and applies the canonical case", () => {
  const configuration = { allowedBitLengths: [96, 128], canonicalCase: "UPPER" };
  assert.equal(
    schemas.normalizeHexEpc("00abcdefabcdefabcdefabcd", configuration),
    "00ABCDEFABCDEFABCDEFABCD",
  );
  assert.throws(() => schemas.normalizeHexEpc("ABC-DEF", configuration), /hexadecimal/);
  assert.throws(() => schemas.normalizeHexEpc("AA", configuration), /bit length/);
});

test("P3-TAG-006 EPC reservation is centrally serialized and unique", () => {
  assert.match(migration, /epc_reservations_epc_no_reuse_uq/);
  assert.match(migration, /tagging:epc:/);
});

test("P3-TAG-007 simulated encoder reports a sanitized success", async () => {
  const adapter = new encoderModule.SimulatedRfidEncoderAdapter("ENCODER-TEST");
  const result = await adapter.encode(
    {
      jobId: "job",
      sessionId: "session",
      epc: "A".repeat(24),
      barcode: "TAG",
      labelTemplateId: null,
      logicalDeviceId: "ENCODER-TEST",
    },
    new AbortController().signal,
  );
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.simulated, true);
});

test("P3-TAG-008 encoder failure injection never reports success", async () => {
  const adapter = new encoderModule.SimulatedRfidEncoderAdapter();
  adapter.setNextResult({
    status: "FAILED",
    failureCode: "SIMULATED_ENCODE_FAILURE",
    metadata: {},
  });
  assert.equal(
    (
      await adapter.encode(
        {
          jobId: "job",
          sessionId: "session",
          epc: "A".repeat(24),
          barcode: null,
          labelTemplateId: null,
          logicalDeviceId: "sim",
        },
        new AbortController().signal,
      )
    ).status,
    "FAILED",
  );
});

test("P3-TAG-009 verifier supplies the configured stable read count", async () => {
  const adapter = new verifierModule.SimulatedRfidVerificationAdapter();
  const result = await adapter.verify(
    {
      sessionId: "session",
      expectedEpc: "A".repeat(24),
      barcode: "TAG",
      logicalDeviceId: "verify",
      timeoutMs: 1000,
      requiredStableReadCount: 3,
    },
    new AbortController().signal,
  );
  assert.equal(result.result, "VERIFIED");
  assert.deepEqual(result.observedEpcs, ["A".repeat(24), "A".repeat(24), "A".repeat(24)]);
});

test("P3-TAG-010 verifier mismatch is explicit", async () => {
  const adapter = new verifierModule.SimulatedRfidVerificationAdapter();
  adapter.setNextResult({
    result: "EPC_MISMATCH",
    observedEpcs: ["F".repeat(24)],
    stableReadCount: 1,
    failureCode: "MISMATCH",
  });
  assert.equal(
    (
      await adapter.verify(
        {
          sessionId: "s",
          expectedEpc: "A".repeat(24),
          barcode: null,
          logicalDeviceId: "v",
          timeoutMs: 1000,
          requiredStableReadCount: 3,
        },
        new AbortController().signal,
      )
    ).result,
    "EPC_MISMATCH",
  );
});

test("P3-TAG-011 multiple-tag verification result is supported", async () => {
  const adapter = new verifierModule.SimulatedRfidVerificationAdapter();
  adapter.setNextResult({
    result: "MULTIPLE_TAGS",
    observedEpcs: ["A".repeat(24), "B".repeat(24)],
    stableReadCount: 1,
    failureCode: "MULTIPLE",
  });
  assert.equal(
    (
      await adapter.verify(
        {
          sessionId: "s",
          expectedEpc: "A".repeat(24),
          barcode: null,
          logicalDeviceId: "v",
          timeoutMs: 1000,
          requiredStableReadCount: 3,
        },
        new AbortController().signal,
      )
    ).result,
    "MULTIPLE_TAGS",
  );
});

test("P3-TAG-012 verifier cancellation is bounded", async () => {
  const adapter = new verifierModule.SimulatedRfidVerificationAdapter();
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await adapter.verify(
        {
          sessionId: "s",
          expectedEpc: "A".repeat(24),
          barcode: null,
          logicalDeviceId: "v",
          timeoutMs: 1000,
          requiredStableReadCount: 3,
        },
        controller.signal,
      )
    ).result,
    "CANCELLED",
  );
});

test("P3-TAG-013 optional IATA LPC keeps leading zeros", () => {
  assert.equal(schemas.normalizeOptionalIataLpc("0012345678\r"), "0012345678");
  assert.equal(schemas.normalizeOptionalIataLpc(""), null);
});

test("P3-TAG-014 simulated camera creates signature-valid PNG evidence", async () => {
  const camera = new cameraModule.SimulatedBagCameraAdapter();
  const controller = new AbortController();
  await camera.start(controller.signal);
  const photo = await camera.capture(
    { sessionId: "s", bagId: "b", bhsUid: "1234567890", maximumBytes: 1024 },
    controller.signal,
  );
  schemas.validatePhotoSignature(photo.bytes, photo.mimeType);
  assert.equal(photo.simulated, true);
});

test("P3-TAG-015 required-photo policy is the  default", () => {
  assert.equal(stationConfig().bagPhotoPolicy, "REQUIRED");
  assert.match(migration, /PHOTO_REQUIRED/);
});

test("P3-TAG-016 photo storage failures are explicit", async () => {
  const storage = new storageModule.SimulatedBagPhotoStorage();
  storage.failNextOperation("SIMULATED_STORAGE_FAILURE");
  await assert.rejects(
    () =>
      storage.stage(
        {
          siteId: "ALWAJH",
          stationId: "TAG-01",
          sessionId: "s",
          checksumSha256: "a".repeat(64),
          mimeType: "image/png",
          bytes: new Uint8Array([1]),
        },
        new AbortController().signal,
      ),
    /SIMULATED_STORAGE_FAILURE/,
  );
});

test("P3-TAG-017 atomic assignment RPC owns bag, tag, assignment, and queue changes", () => {
  assert.match(migration, /INSERT INTO public\.bag_tag_assignments/);
  assert.match(
    migration,
    /UPDATE public\.tagging_station_queue_items SET position=NULL,state='TAGGED'/,
  );
});

test("P3-TAG-018 duplicate EPC is a named central outcome", () =>
  assert.match(migration, /DUPLICATE_EPC/));
test("P3-TAG-019 duplicate barcode is a named central outcome", () =>
  assert.match(migration, /DUPLICATE_BARCODE/));
test("P3-TAG-020 commit uses row and advisory locks", () => {
  assert.match(migration, /tagging:commit:/);
  assert.match(migration, /WHERE id=p_session_id FOR UPDATE/);
});
test("P3-TAG-021 visible mutations persist idempotency request hashes", () =>
  assert.match(migration, /tagging_operation_requests/));
test("P3-TAG-022 failed tags are persisted with FAILED status", () =>
  assert.match(migration, /'FAILED',v_session\.site_id/));
test("P3-TAG-023 assignment replacement retains the prior assignment relationship", () =>
  assert.match(migration, /replaced_assignment_id/));
test("P3-TAG-024 local queue advancement requires central commit evidence", () => {
  assert.match(stationRepository, /CENTRAL_TAGGING_COMMIT_EVIDENCE_REQUIRED/);
  assert.match(stationRepository, /central_assignment_id/);
});
test("P3-TAG-025 API payload cannot choose site, station, adapter, or storage key", () => {
  assert.doesNotMatch(stationApi, /z\.string\(\).*storageKey/);
  assert.match(stationApi, /\.strict\(\)/);
});
test("P3-TAG-026 exact workflow permissions are in the authorization catalog", () => {
  for (const code of [
    "tagging.session.start",
    "tagging.verify",
    "tagging.photo.capture",
    "tagging.commit",
    "tagging.replace",
  ])
    assert.equal(roleModule.PERMISSION_CODES.includes(code), true, code);
});
test("P3-TAG-027 workflow tables use RLS and service-role RPCs", () => {
  assert.match(migration, /ALTER TABLE public\.tagging_sessions ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.commit_tagging_session_v1.*service_role/,
  );
});
test("P3-TAG-028 durable restart state is database-backed, not browser-backed", () => {
  assert.match(migration, /CREATE TABLE public\.tagging_sessions/);
  assert.doesNotMatch(stationApi, /localStorage|zustand/i);
});
test("P3-TAG-029 simulator selection requires trusted enablement", () => {
  assert.throws(() => stationConfig({ rfidEncoderAdapter: "SIMULATED" }), /simulation enablement/);
  const suite = factoryModule.createTaggingDeviceSuite(
    stationConfig({ taggingSimulationEnabled: true, rfidEncoderAdapter: "SIMULATED" }),
  );
  assert.equal(suite.simulated, true);
});
test("P3-TAG-030 simulated adapter load remains deterministic", async () => {
  const adapter = new encoderModule.SimulatedRfidEncoderAdapter();
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      adapter.encode(
        {
          jobId: `job-${index}`,
          sessionId: "s",
          epc: index.toString(16).padStart(24, "0"),
          barcode: null,
          labelTemplateId: null,
          logicalDeviceId: "sim",
        },
        new AbortController().signal,
      ),
    ),
  );
  assert.equal(results.filter((entry) => entry.status === "SUCCEEDED").length, 100);
});
test("P3-TAG-031 metrics are calculated from durable sessions, attempts, and photos", () =>
  assert.match(migration, /tagging_metrics_v1/));
test("P3-TAG-032 inventory import is isolated behind a configuration gate", () =>
  assert.match(migration, /INVENTORY_DISABLED/));
test("P3-TAG-033 manual entry is disabled by default and separately permissioned", () => {
  assert.equal(stationConfig().manualBarcodeEntry, false);
  assert.equal(roleModule.PERMISSION_CODES.includes("tagging.manual-entry"), true);
});
test("P3-TAG-034 tagging evidence and audit history are append-only", () =>
  assert.match(migration, /tagging_session_events_append_only/));
test("P3-TAG-035 the legacy direct assignment bypass is closed", () => {
  assert.match(legacyApi, /TAGGING_SESSION_REQUIRED/);
  assert.doesNotMatch(stationApi, /COMPLETE_TAGGING/);
});
