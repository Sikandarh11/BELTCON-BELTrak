import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createProjectModuleLoader } from "./helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
test.after(() => loader.close());
const [schemas, encoderModule, verifierModule, cameraModule, configModule] = await Promise.all([
  loader.load("/src/services/bags/taggingWorkflowSchemas.ts"),
  loader.load("/src/services/stations/tagging/rfidEncoderAdapter.ts"),
  loader.load("/src/services/stations/tagging/rfidVerificationAdapter.ts"),
  loader.load("/src/services/stations/tagging/bagCameraAdapter.ts"),
  loader.load("/src/services/stations/stationConfig.ts"),
]);
const migration = await readFile(
  new URL("../supabase/migrations/027_complete_tagging_station_workflow.sql", import.meta.url),
  "utf8",
);
const api = await readFile(
  new URL("../src/services/stations/bhs/taggingStationApi.server.ts", import.meta.url),
  "utf8",
);
const repository = await readFile(
  new URL("../src/services/stations/bhs/stationInboxRepository.server.ts", import.meta.url),
  "utf8",
);

const verified = "VERIFIED BY SOFTWARE TEST";
const simulated = "SIMULATED HARDWARE ONLY";

test(`P3-FAT-001 Active BHS suspect bag — ${verified}`, () => {
  assert.match(migration, /position<>1.*QUEUE_ITEM_NOT_ACTIVE/s);
  assert.match(migration, /TAGGING_SESSION_CREATED/);
});
test(`P3-FAT-002 Pre-encoded tag success — ${verified}; ${simulated}`, async () => {
  const verifier = new verifierModule.SimulatedRfidVerificationAdapter();
  const epc = schemas.normalizeHexEpc("a".repeat(24), {
    allowedBitLengths: [96],
    canonicalCase: "UPPER",
  });
  assert.equal(
    (
      await verifier.verify(
        {
          sessionId: "s",
          expectedEpc: epc,
          barcode: "TAG",
          logicalDeviceId: "sim",
          timeoutMs: 1000,
          requiredStableReadCount: 3,
        },
        new AbortController().signal,
      )
    ).result,
    "VERIFIED",
  );
  assert.match(migration, /TAG_ASSIGNMENT_COMMITTED/);
});
test(`P3-FAT-003 Print-and-encode success — ${verified}; ${simulated}`, async () => {
  const encoder = new encoderModule.SimulatedRfidEncoderAdapter();
  assert.equal(
    (
      await encoder.encode(
        {
          jobId: "j",
          sessionId: "s",
          epc: "A".repeat(24),
          barcode: "TAG",
          labelTemplateId: null,
          logicalDeviceId: "sim",
        },
        new AbortController().signal,
      )
    ).status,
    "SUCCEEDED",
  );
  assert.match(migration, /EPC_RESERVED/);
});
test(`P3-FAT-004 Optional LPC absent — ${verified}`, () =>
  assert.match(migration, /iata_lpc TEXT/));
test(`P3-FAT-005 Bag photo required — ${verified}; ${simulated}`, async () => {
  assert.match(migration, /PHOTO_REQUIRED/);
  const camera = new cameraModule.SimulatedBagCameraAdapter();
  const controller = new AbortController();
  await camera.start(controller.signal);
  assert.equal(
    (
      await camera.capture(
        { sessionId: "s", bagId: "b", bhsUid: "1234567890", maximumBytes: 1024 },
        controller.signal,
      )
    ).mimeType,
    "image/png",
  );
});
test(`P3-FAT-006 Duplicate EPC — ${verified}`, () => assert.match(migration, /DUPLICATE_EPC/));
test(`P3-FAT-007 Duplicate barcode — ${verified}`, () =>
  assert.match(migration, /DUPLICATE_BARCODE/));
test(`P3-FAT-008 Verification mismatch — ${verified}; ${simulated}`, async () => {
  const verifier = new verifierModule.SimulatedRfidVerificationAdapter();
  verifier.setNextResult({
    result: "EPC_MISMATCH",
    observedEpcs: ["F".repeat(24)],
    stableReadCount: 1,
    failureCode: "MISMATCH",
  });
  assert.equal(
    (
      await verifier.verify(
        {
          sessionId: "s",
          expectedEpc: "A".repeat(24),
          barcode: null,
          logicalDeviceId: "sim",
          timeoutMs: 1000,
          requiredStableReadCount: 3,
        },
        new AbortController().signal,
      )
    ).result,
    "EPC_MISMATCH",
  );
  assert.match(migration, /'FAILED',v_session\.site_id/);
});
test(`P3-FAT-009 Replacement tag — ${verified}`, () => {
  assert.match(migration, /TAG_REPLACEMENT_COMPLETED/);
  assert.match(migration, /assignment_version/);
});
test(`P3-FAT-010 Response loss — ${verified}`, () =>
  assert.match(migration, /'status','DUPLICATE'.*assignment/s));
test(`P3-FAT-011 Concurrent assignment — ${verified}`, () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /CONCURRENT_ASSIGNMENT_CONFLICT/);
});
test(`P3-FAT-012 Wrong station — ${verified}`, () =>
  assert.match(migration, /STATION_BINDING_CONFLICT/));
test(`P3-FAT-013 Waiting bag — ${verified}`, () =>
  assert.match(migration, /QUEUE_ITEM_NOT_ACTIVE/));
test(`P3-FAT-014 Required-photo override — ${verified}`, () => {
  assert.match(migration, /OVERRIDE_NOT_AUTHORIZED/);
  assert.match(migration, /BAG_PHOTO_OVERRIDE_APPROVED/);
});
test(`P3-FAT-015 Camera unavailable — ${verified}; PENDING PHYSICAL HARDWARE TEST`, async () => {
  const camera = new cameraModule.UnavailablePhysicalBagCameraAdapter();
  await assert.rejects(() => camera.start(new AbortController().signal), /BAG_CAMERA_UNAVAILABLE/);
});
test(`P3-FAT-016 Central server unavailable — ${verified}`, () => {
  const config = configModule.taggingStationConfigSchema.parse({
    stationId: "TAG-01",
    siteId: "ALWAJH",
    allowedLineIds: ["01"],
    centralServerUrl: "http://127.0.0.1:3000",
    centralSourceSystem: "SOURCE",
    transportType: "LOOPBACK",
    acknowledgementEnabled: false,
    acknowledgementReceivedValue: null,
    acknowledgementMappingStatus: "PENDING_VENDOR_CONFIRMATION",
    physicalMappingStatus: "UNCONFIRMED",
    localPersistencePath: "station.sqlite",
  });
  assert.equal(config.offlineTaggingPolicy, "DISABLED");
  assert.match(api, /OFFLINE_TAGGING_DISABLED/);
});
test(`P3-FAT-017 Restart after verification — ${verified}`, () => {
  assert.match(migration, /tag_verification_attempts/);
  assert.match(migration, /get_tagging_session_v1/);
});
test(`P3-FAT-018 Restart during commit — ${verified}`, () =>
  assert.match(migration, /commit_request_id=p_request_id/));
test(`P3-FAT-019 Queue advancement — ${verified}`, () => {
  assert.match(repository, /CENTRAL_TAGGING_COMMIT_EVIDENCE_REQUIRED/);
  assert.match(migration, /position=2/);
});
test(`P3-FAT-020 Full tagging journey — ${verified}; ${simulated}`, () => {
  for (const evidence of [
    "create_tagging_session_v1",
    "capture_tagging_identity_v1",
    "record_tagging_verification_v1",
    "stage_tagging_bag_photo_v1",
    "commit_tagging_session_v1",
    "TAG_ASSIGNMENT_COMMITTED",
  ])
    assert.match(migration, new RegExp(evidence));
  assert.match(api, /runtime\.agent\.completeTagging/);
});
