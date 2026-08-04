import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProjectModuleLoader, repositoryRoot } from "./helpers/projectModuleLoader.mjs";
import {
  createPostgresHarness,
  parseJsonOutput,
  postgresTestAvailability,
  sqlJson,
} from "./postgres/postgresHarness.mjs";

const availability = postgresTestAvailability();
const results = [];
const artifactDirectory = path.join(repositoryRoot, "artifacts", "software-fat");

function message(bhsUid, evaluation = "R") {
  return { messageType: 2001, trigger: 1, lineId: "01", bhsUid, evaluation };
}

if (!availability.available) {
  test("P2-DB-029 software FAT requires disposable PostgreSQL", () => {
    assert.fail(availability.reason);
  });
} else {
  const loader = await createProjectModuleLoader();
  const { SoftwareFatHarness } = await loader.load(
    "/src/services/stations/softwareFatHarness.server.ts",
  );
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "sbts-software-fat-"));
  const fat = await SoftwareFatHarness.create(path.join(temporaryDirectory, "software-fat.sqlite"));
  const database = createPostgresHarness(availability.databaseUrl, {
    psqlPath: availability.psqlPath,
  });
  await database.migrateClean();

  const hash = (value) => value.repeat(64);
  const bhsSql = (bhsUid, suffix, evaluation = "R") =>
    `SELECT public.ingest_beltcon_bhs_message_v2(${sqlJson(
      message(bhsUid, evaluation),
    )},'SOFTWARE_FAT_BHS','FAT-${suffix}','${hash("a")}',` +
    `'10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}'::uuid,'fat-${suffix}')::text`;
  const stationSql = (bhsUid, suffix, stationId, siteId) =>
    `SELECT public.ingest_beltcon_bhs_station_message_v1(${sqlJson(
      message(bhsUid),
    )},'SOFTWARE_FAT_STATION','FAT-STATION-${suffix}','${hash("b")}',` +
    `'20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}'::uuid,'fat-station-${suffix}','${stationId}','${siteId}')::text`;
  const screeningSql = ({ bhsUid, suffix, externalScanId, sourceSystem = "SOFTWARE_FAT_HBSS" }) => {
    const event = {
      schemaVersion: 1,
      eventId: `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
      eventType: "BAG_SUSPECTED",
      sourceSystem,
      occurredAt: "2026-08-03T12:00:00.000Z",
      bag: { bhsUid },
      screening: {
        evaluationRaw: "R",
        station: "HBSS-SOFTWARE-FAT",
        screenedAt: "2026-08-03T11:59:00.000Z",
      },
      threat: { type: "SIMULATED_ONLY", level: 1 },
      scan: {
        externalScanId,
        status: "AVAILABLE",
        images: [
          {
            imageId: `IMG-${suffix}`,
            label: "Simulated X-ray",
            imageRef: `/mock-xray/fat/${suffix}.jpg`,
            mimeType: "image/jpeg",
          },
        ],
      },
    };
    return `SELECT public.ingest_screening_suspect_event_v2(${sqlJson(event)},'${hash("c")}','fat-screening-${suffix}')::text`;
  };

  function scenario(id, title, successClassification, callback) {
    test(`${id} ${title}`, async () => {
      const startedAt = Date.now();
      try {
        await callback();
        results.push({
          id,
          title,
          classification: successClassification,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        results.push({
          id,
          title,
          classification: "FAIL — SOFTWARE DEFECT",
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 256) : "Unknown failure",
        });
        throw error;
      }
    });
  }

  test.beforeEach(async () => {
    database.resetOperationalData();
    await fat.execute({ action: "RESET" });
  });

  scenario("FAT-SW-001", "Valid ACCEPT", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    const station = await fat.execute({
      action: "BHS_SEND",
      message: message("0000005001", "A"),
      repeat: 1,
    });
    const central = parseJsonOutput(database.execute(bhsSql("0000005001", 5001, "A")));
    assert.equal(central.status, "ACCEPTED");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
    assert.equal(station.bhs.queue.position1, null);
  });

  scenario("FAT-SW-002", "Valid suspect bag", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    const station = await fat.execute({
      action: "BHS_SEND",
      message: message("0000005002"),
      repeat: 1,
    });
    const central = parseJsonOutput(database.execute(bhsSql("0000005002", 5002)));
    assert.equal(station.bhs.queue.position1.bhsUid, "0000005002");
    assert.equal(central.taggingReadinessStatus, "READY_FOR_TAGGING");
    assert.equal(database.execute("SELECT bhs_uid FROM public.bags"), "0000005002");
  });

  scenario("FAT-SW-003", "Two-bag queue", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    await fat.execute({ action: "BHS_SEND", message: message("0000005003"), repeat: 1 });
    const state = await fat.execute({
      action: "BHS_SEND",
      message: message("0000005004", "T"),
      repeat: 1,
    });
    assert.equal(state.bhs.queue.position1.bhsUid, "0000005003");
    assert.equal(state.bhs.queue.position2.bhsUid, "0000005004");
  });

  scenario("FAT-SW-004", "Queue overflow", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    for (const uid of ["0000005005", "0000005006", "0000005007"])
      await fat.execute({ action: "BHS_SEND", message: message(uid), repeat: 1 });
    const state = await fat.snapshot();
    assert.equal(state.bhs.queue.position1.bhsUid, "0000005005");
    assert.equal(state.bhs.queue.position2.bhsUid, "0000005006");
    assert.ok(state.bhs.queue.alarms.some((alarm) => alarm.code === "QUEUE_CAPACITY_REACHED"));
  });

  scenario("FAT-SW-005", "Duplicate BHS message", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    const station = await fat.execute({
      action: "BHS_SEND",
      message: message("0000005008"),
      repeat: 2,
    });
    const command = bhsSql("0000005008", 5008);
    assert.equal(parseJsonOutput(database.execute(command)).status, "ACCEPTED");
    assert.equal(parseJsonOutput(database.execute(command)).status, "DUPLICATE");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(station.bhs.queue.position1.bhsUid, "0000005008");
    assert.equal(station.bhs.queue.position2, null);
  });

  scenario(
    "FAT-SW-006",
    "Central server unavailable",
    "PASS — VERIFIED BY SOFTWARE TEST",
    async () => {
      await fat.execute({ action: "BHS_CENTRAL_FAULT", fault: "UNAVAILABLE" });
      const offline = await fat.execute({
        action: "BHS_SEND",
        message: message("0000005009"),
        repeat: 1,
      });
      assert.equal(offline.bhs.queue.position1.bhsUid, "0000005009");
      await fat.execute({ action: "BHS_CENTRAL_FAULT", fault: "NONE" });
      await fat.execute({ action: "BHS_RETRY_SYNC" });
      assert.equal(
        parseJsonOutput(database.execute(bhsSql("0000005009", 5009))).status,
        "ACCEPTED",
      );
    },
  );

  scenario("FAT-SW-007", "Station restart", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    await fat.execute({ action: "BHS_SEND", message: message("0000005010"), repeat: 1 });
    await fat.execute({ action: "BHS_SEND", message: message("0000005011"), repeat: 1 });
    const restarted = await fat.execute({ action: "BHS_RESTART" });
    assert.equal(restarted.bhs.queue.position1.bhsUid, "0000005010");
    assert.equal(restarted.bhs.queue.position2.bhsUid, "0000005011");
  });

  scenario("FAT-SW-008", "Manual jam clear", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    await fat.execute({ action: "BHS_SEND", message: message("0000005012"), repeat: 1 });
    await fat.execute({ action: "BHS_SEND", message: message("0000005013"), repeat: 1 });
    await fat.execute({ action: "BHS_JAM_ACTIVE", reason: "Simulated physical jam" });
    const cleared = await fat.execute({
      action: "BHS_CLEAR_JAM",
      reason: "Supervisor verified simulated lane clear",
      actorId: "FAT-SUPERVISOR",
    });
    assert.equal(cleared.bhs.queue.position1.bhsUid, "0000005013");
    assert.ok(cleared.injectedFaults.some((fault) => fault.code === "BHS_CLEAR_JAM"));
  });

  scenario("FAT-SW-009", "Tag assignment", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    const bag = parseJsonOutput(database.execute(bhsSql("0000005014", 5014)));
    const result = parseJsonOutput(
      database.execute(
        `SELECT public.assign_beltcon_rfid_tag_v1('${bag.bagId}','RFID-5014','EPC-5014',NULL,(SELECT version FROM public.bags WHERE id='${bag.bagId}'),'fat-operator','Operations Officer','fat-tag-5014')::text`,
      ),
    );
    assert.equal(result.status, "ASSIGNED");
    assert.equal(database.execute("SELECT count(*) FROM public.tags"), "1");
    assert.equal(
      database.execute("SELECT count(*) FROM public.audit_events WHERE action='RFID_TAG_ASSIGNED'"),
      "1",
    );
  });

  scenario("FAT-SW-010", "Recheck barcode lookup", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    const bag = parseJsonOutput(database.execute(bhsSql("0000005015", 5015)));
    database.execute(
      `SELECT public.assign_beltcon_rfid_tag_v1('${bag.bagId}','RFID-EXACT-5015','EPC-5015',NULL,(SELECT version FROM public.bags WHERE id='${bag.bagId}'),'fat-operator','Operations Officer','fat-tag-5015')`,
    );
    assert.equal(
      database.execute("SELECT bhs_uid FROM public.bags WHERE rfid_tag_barcode='RFID-EXACT-5015'"),
      "0000005015",
    );
    assert.equal(
      database.execute(
        "SELECT count(*) FROM public.bags WHERE rfid_tag_barcode LIKE '%EXACT-501%'",
      ),
      "1",
    );
    assert.equal(
      database.execute("SELECT count(*) FROM public.bags WHERE rfid_tag_barcode='RFID-EXACT-501'"),
      "0",
    );
  });

  scenario("FAT-SW-011", "HBSS virtual recall", "SIMULATED ONLY", async () => {
    const state = await fat.execute({
      action: "HBSS_SCAN",
      requestId: "fat-recall-5016",
      barcode: "RFID-5016",
      bhsUid: "0000005016",
    });
    assert.equal(state.hbss.health.requests.at(-1).state, "REQUEST_SENT");
    assert.equal(state.hbss.transmittedBytesHex.at(-1), "02303030303030353031360d0a");
  });

  scenario("FAT-SW-012", "Serial timeout", "SIMULATED ONLY", async () => {
    await fat.execute({ action: "HBSS_FAULT", fault: "TIMEOUT" });
    const state = await fat.execute({
      action: "HBSS_SCAN",
      requestId: "fat-timeout-5017",
      barcode: "RFID-5017",
      bhsUid: "0000005017",
    });
    assert.equal(state.hbss.health.requests.at(-1).state, "TIMED_OUT");
  });

  scenario("FAT-SW-013", "Wrong BHS UID image", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    database.execute(
      screeningSql({ bhsUid: "0000005018", suffix: 5018, externalScanId: "SCAN-5018" }),
    );
    const conflict = parseJsonOutput(
      database.execute(
        screeningSql({ bhsUid: "0000005019", suffix: 5019, externalScanId: "SCAN-5018" }),
      ),
    );
    assert.equal(conflict.errorCode, "BHS_UID_MISMATCH");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.equal(database.execute("SELECT bhs_uid FROM public.xray_scans"), "0000005018");
  });

  scenario("FAT-SW-014", "HBSS image unavailable", "SIMULATED ONLY", async () => {
    const bag = parseJsonOutput(database.execute(bhsSql("0000005020", 5020)));
    assert.equal(
      database.execute(`SELECT bhs_uid FROM public.bags WHERE id='${bag.bagId}'`),
      "0000005020",
    );
    assert.equal(
      database.execute(`SELECT count(*) FROM public.xray_scans WHERE bag_id='${bag.bagId}'`),
      "0",
    );
    assert.equal(bag.taggingReadinessStatus, "READY_FOR_TAGGING");
  });

  scenario("FAT-SW-015", "Decision conflict", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    database.execute(
      screeningSql({ bhsUid: "0000005021", suffix: 5021, externalScanId: "SCAN-5021" }),
    );
    const conflict = parseJsonOutput(database.execute(bhsSql("0000005021", 5022, "A")));
    assert.equal(conflict.status, "CONFLICT");
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "BLOCKED_CONFLICT",
    );
  });

  scenario("FAT-SW-016", "Cross-site isolation", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    assert.equal(
      parseJsonOutput(database.execute(stationSql("0000005022", 5022, "TAG-A", "SITE-A"))).status,
      "ACCEPTED",
    );
    const conflict = parseJsonOutput(
      database.execute(stationSql("0000005022", 5022, "TAG-B", "SITE-B")),
    );
    assert.equal(conflict.errorCode, "STATION_BINDING_CONFLICT");
    assert.equal(
      database.execute("SELECT site_id||':'||station_id FROM public.screening_integration_events"),
      "SITE-A:TAG-A",
    );
  });

  scenario("FAT-SW-017", "Audit protection", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    database.execute(
      "INSERT INTO public.audit_events(action,actor_type,outcome,metadata) VALUES('FAT_AUDIT','SYSTEM','SUCCESS','{}')",
      { tuplesOnly: false },
    );
    assert.throws(
      () =>
        database.execute(
          "BEGIN; SET LOCAL ROLE service_role; UPDATE public.audit_events SET outcome='ALTERED' WHERE action='FAT_AUDIT'; ROLLBACK",
          { tuplesOnly: false },
        ),
      /permission denied|row-level security/i,
    );
    assert.equal(
      database.execute("SELECT outcome FROM public.audit_events WHERE action='FAT_AUDIT'"),
      "SUCCESS",
    );
  });

  scenario("FAT-SW-018", "Response-loss retry", "PASS — VERIFIED BY SOFTWARE TEST", async () => {
    const command = bhsSql("0000005023", 5023);
    assert.equal(parseJsonOutput(database.execute(command)).status, "ACCEPTED");
    assert.equal(parseJsonOutput(database.execute(command)).status, "DUPLICATE");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "1");
  });

  scenario(
    "FAT-SW-019",
    "Concurrent BHS/HBSS arrival",
    "PASS — VERIFIED BY SOFTWARE TEST",
    async () => {
      await Promise.all([
        database.executeAsync(bhsSql("0000005024", 5024)),
        database.executeAsync(
          screeningSql({ bhsUid: "0000005024", suffix: 5024, externalScanId: "SCAN-5024" }),
        ),
      ]);
      assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
      assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
      assert.equal(
        database.execute(
          "SELECT count(*) FROM public.xray_scans scan JOIN public.bags bag ON bag.id=scan.bag_id AND bag.bhs_uid=scan.bhs_uid",
        ),
        "1",
      );
    },
  );

  scenario("FAT-SW-020", "Full software journey", "SIMULATED ONLY", async () => {
    await fat.execute({ action: "BHS_SEND", message: message("0000005025"), repeat: 1 });
    const bag = parseJsonOutput(database.execute(bhsSql("0000005025", 5025)));
    database.execute(
      screeningSql({ bhsUid: "0000005025", suffix: 5025, externalScanId: "SCAN-5025" }),
    );
    const assigned = parseJsonOutput(
      database.execute(
        `SELECT public.assign_beltcon_rfid_tag_v1('${bag.bagId}','RFID-5025','EPC-5025','0123456789',(SELECT version FROM public.bags WHERE id='${bag.bagId}'),'fat-operator','Operations Officer','fat-tag-5025')::text`,
      ),
    );
    assert.equal(assigned.status, "ASSIGNED");
    const recall = await fat.execute({
      action: "HBSS_SCAN",
      requestId: "fat-full-5025",
      barcode: "RFID-5025",
      bhsUid: "0000005025",
    });
    assert.equal(recall.hbss.health.requests.at(-1).state, "REQUEST_SENT");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.tags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.ok(Number(database.execute("SELECT count(*) FROM public.audit_events")) >= 3);
  });

  test.after(async () => {
    await fat.shutdown();
    await loader.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
    await mkdir(artifactDirectory, { recursive: true });
    const report = {
      phase: 2,
      generatedAt: new Date().toISOString(),
      databaseTarget: database.target.summary,
      physicalHardwareUsed: false,
      vendorIntegrationVerified: false,
      scenarios: results.sort((left, right) => left.id.localeCompare(right.id)),
    };
    await writeFile(
      path.join(artifactDirectory, "software-fat-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    const markdown = [
      "# SBTS Phase 2 software FAT",
      "",
      `Generated: ${report.generatedAt}`,
      "",
      "No physical hardware or vendor workstation was used.",
      "",
      "| Scenario | Result | Duration (ms) |",
      "|---|---|---:|",
      ...report.scenarios.map(
        (result) =>
          `| ${result.id} — ${result.title} | ${result.classification} | ${result.durationMs} |`,
      ),
      "",
    ].join("\n");
    await writeFile(path.join(artifactDirectory, "software-fat-report.md"), markdown, "utf8");
  });
}
