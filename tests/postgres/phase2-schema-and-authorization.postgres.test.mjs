import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPostgresHarness,
  discoverPostgresMigrations,
  parseJsonOutput,
  postgresTestAvailability,
  sqlJson,
} from "./postgresHarness.mjs";

const availability = postgresTestAvailability();
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

if (!availability.available) {
  test("P2 database schema and authorization gate", { skip: availability.reason }, () => {
    if (process.env.SBTS_REQUIRE_POSTGRES_TESTS === "true") throw new Error(availability.reason);
  });
} else {
  const database = createPostgresHarness(availability.databaseUrl, {
    psqlPath: availability.psqlPath,
  });
  test.before(async () => database.migrateClean());
  test.beforeEach(() => database.resetOperationalData());

  const hash = (value) => value.repeat(64);
  const bhsMessage = (bhsUid, evaluation = "R", lineId = "01") => ({
    messageType: 2001,
    trigger: 1,
    lineId,
    bhsUid,
    evaluation,
  });
  const bhsSql = (bhsUid, suffix, evaluation = "R") =>
    `SELECT public.ingest_beltcon_bhs_message_v2(${sqlJson(
      bhsMessage(bhsUid, evaluation),
    )},'PHASE2_DB_BHS','P2-${suffix}','${hash("d")}',` +
    `'00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}'::uuid,'p2-db-${suffix}')::text`;
  const stationSql = ({ bhsUid, suffix, stationId, siteId }) =>
    `SELECT public.ingest_beltcon_bhs_station_message_v1(${sqlJson(
      bhsMessage(bhsUid),
    )},'PHASE2_STATION','P2-STATION-${suffix}','${hash("e")}',` +
    `'00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}'::uuid,'p2-station-${suffix}',` +
    `'${stationId}','${siteId}')::text`;

  test("P2-DB-002 migration chain preserves 001-027 and appends reader registry migration 028", async () => {
    const migrations = await discoverPostgresMigrations();
    assert.equal(migrations.length, 28);
    assert.deepEqual(
      migrations.map((file) => Number.parseInt(file.slice(0, 3), 10)),
      Array.from({ length: 28 }, (_, index) => index + 1),
    );
    assert.equal(migrations.at(-4), "025_bhs_hbss_integrity_hardening.sql");
    assert.equal(migrations.at(-3), "026_station_delivery_metadata.sql");
    assert.equal(migrations.at(-2), "027_complete_tagging_station_workflow.sql");
    assert.equal(migrations.at(-1), "028_create_beltcon_authoritative_reader_registry.sql");
    assert.equal(database.execute("SELECT to_regclass('public.bags') IS NOT NULL"), "t");
  });

  test("P2-DB-003 final deployed tables and integration columns exist in PostgreSQL catalogs", () => {
    const tables = [
      "profiles",
      "bags",
      "tags",
      "rfid_events",
      "alarms",
      "resolutions",
      "readers",
      "audit_events",
      "screening_integration_events",
      "xray_scans",
      "hbss_recall_requests",
      "tagging_readiness_configuration",
    ];
    for (const tableName of tables)
      assert.equal(
        database.execute(`SELECT to_regclass('public.${tableName}') IS NOT NULL`),
        "t",
        tableName,
      );
    const columns = database.execute(
      `SELECT string_agg(column_name,',' ORDER BY column_name)
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='screening_integration_events'
         AND column_name IN ('station_id','site_id','station_synchronized_at','message_fingerprint','bhs_line_id')`,
    );
    assert.equal(
      columns,
      "bhs_line_id,message_fingerprint,site_id,station_id,station_synchronized_at",
    );
    for (const columnName of [
      "bhs_uid",
      "bhs_confirmation_status",
      "bhs_confirmed_at",
      "tagging_readiness_status",
      "tagging_ready_at",
    ])
      assert.equal(
        database.execute(
          `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='bags' AND column_name='${columnName}'`,
        ),
        "1",
      );
  });

  test("P2-DB-003 final functions, triggers, constraints, indexes, and RLS are deployed", () => {
    const functions = [
      "ingest_beltcon_bhs_message_v2(jsonb,text,text,text,uuid,text)",
      "ingest_beltcon_bhs_station_message_v1(jsonb,text,text,text,uuid,text,text,text)",
      "ingest_screening_suspect_event_v2(jsonb,text,text)",
      "assign_beltcon_rfid_tag_v1(text,text,text,text,integer,text,text,text)",
      "begin_beltcon_hbss_recall_v1(text,text,integer,integer,uuid,text,text,text,text)",
      "complete_beltcon_hbss_recall_v1(uuid,text,text,text,jsonb,text)",
    ];
    for (const signature of functions)
      assert.equal(
        database.execute(`SELECT to_regprocedure('public.${signature}') IS NOT NULL`),
        "t",
      );
    for (const triggerName of [
      "prevent_xray_scan_identity_reassignment",
      "enforce_xray_bag_bhs_correlation_v1",
      "refresh_beltcon_tagging_readiness_from_xray_v1",
      "prevent_beltcon_tag_identity_mutation_v1",
    ])
      assert.equal(
        database.execute(
          `SELECT count(*) FROM pg_trigger WHERE tgname='${triggerName}' AND NOT tgisinternal`,
        ),
        "1",
        triggerName,
      );
    assert.ok(
      Number(
        database.execute(
          "SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace",
        ),
      ) > 40,
    );
    assert.equal(
      database.execute(
        "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='idx_screening_integration_station_delivery'",
      ),
      "1",
    );
    for (const tableName of [
      "bags",
      "xray_scans",
      "screening_integration_events",
      "hbss_recall_requests",
      "audit_events",
    ])
      assert.equal(
        database.execute(
          `SELECT relrowsecurity FROM pg_class WHERE oid='public.${tableName}'::regclass`,
        ),
        "t",
      );
  });

  test("P2-DB-003 schema vocabulary and source-scoped identities match application contracts", () => {
    const constraints = database.execute(
      `SELECT string_agg(pg_get_constraintdef(oid),' ' ORDER BY conname)
       FROM pg_constraint WHERE conrelid IN ('public.bags'::regclass,'public.xray_scans'::regclass,'public.hbss_recall_requests'::regclass)`,
    );
    assert.match(constraints, /octet_length\(bhs_uid\) = 10/i);
    assert.match(constraints, /BASE_ALWAJH|tagging_readiness/i);
    assert.match(constraints, /TIMED_OUT/);
    assert.equal(
      database.execute(
        "SELECT indexdef LIKE '%source_system, external_scan_id%' FROM pg_indexes WHERE schemaname='public' AND indexname='idx_xray_scans_source_external'",
      ),
      "t",
    );
    assert.equal(
      database.execute(
        "SELECT confdeltype FROM pg_constraint WHERE conname='xray_scans_bag_id_fkey'",
      ),
      "n",
    );
  });

  test("P2-DB-011 exact BHS UID matching remains case-sensitive and internal IDs remain distinct", () => {
    const upper = parseJsonOutput(database.execute(bhsSql("AbCdEf1234", 3101)));
    const lower = parseJsonOutput(database.execute(bhsSql("abcdef1234", 3102)));
    assert.notEqual(upper.bagId, upper.bhsUid);
    assert.notEqual(lower.bagId, lower.bhsUid);
    assert.notEqual(upper.bagId, lower.bagId);
    assert.equal(database.execute("SELECT count(DISTINCT bhs_uid) FROM public.bags"), "2");
  });

  test("P2-DB-016 base  policy permits optional IATA, X-ray, and threat evidence", () => {
    const result = parseJsonOutput(database.execute(bhsSql("0000003103", 3103, "T")));
    assert.equal(result.taggingReadinessStatus, "READY_FOR_TAGGING");
    assert.equal(result.canAssignTag, true);
    assert.equal(
      database.execute(
        "SELECT iata_code IS NULL AND threat_level IS NULL AND threat_type IS NULL FROM public.bags",
      ),
      "t",
    );
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "0");
  });

  test("P2-DB-017 tag assignment is atomic, retry-safe, audited, and preserves BHS identity", async () => {
    const accepted = parseJsonOutput(database.execute(bhsSql("0000003104", 3104)));
    const bagId = accepted.bagId;
    const version = database.execute(`SELECT version FROM public.bags WHERE id='${bagId}'`);
    const command = `SELECT public.assign_beltcon_rfid_tag_v1('${bagId}','RFID-3104','EPC-3104',NULL,${version},'actor','Operations Officer','tag-3104')::text`;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => database.executeAsync(command)),
    );
    const statuses = results.map((output) => parseJsonOutput(output).status);
    assert.equal(statuses.filter((status) => status === "ASSIGNED").length, 1);
    assert.equal(statuses.filter((status) => status === "DUPLICATE").length, 24);
    assert.equal(
      database.execute(
        `SELECT bhs_uid||':'||epc||':'||rfid_tag_barcode FROM public.bags WHERE id='${bagId}'`,
      ),
      "0000003104:EPC-3104:RFID-3104",
    );
    assert.equal(
      database.execute("SELECT count(*) FROM public.audit_events WHERE action='RFID_TAG_ASSIGNED'"),
      "1",
    );
    assert.equal(
      database.execute("SELECT count(*) FROM public.tags WHERE bag_id='" + bagId + "'"),
      "1",
    );
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "0");
  });

  test("P2-DB-017 one RFID identity cannot be assigned to another bag", () => {
    const first = parseJsonOutput(database.execute(bhsSql("0000003105", 3105)));
    const second = parseJsonOutput(database.execute(bhsSql("0000003106", 3106)));
    const assign = (bagId, requestId) =>
      parseJsonOutput(
        database.execute(
          `SELECT public.assign_beltcon_rfid_tag_v1('${bagId}','RFID-SHARED','EPC-SHARED','0123456789',(SELECT version FROM public.bags WHERE id='${bagId}'),'actor','Operations Officer','${requestId}')::text`,
        ),
      );
    assert.equal(assign(first.bagId, "tag-first").status, "ASSIGNED");
    assert.equal(assign(second.bagId, "tag-second").status, "DUPLICATE_EPC");
    assert.equal(database.execute("SELECT count(*) FROM public.bags WHERE epc='EPC-SHARED'"), "1");
  });

  test("P2-DB-027 HBSS and RFID high-contention races converge deterministically", async (context) => {
    const startedAt = Date.now();
    const scanBag = parseJsonOutput(database.execute(bhsSql("0000003150", 3150)));
    const duplicateScan = `INSERT INTO public.xray_scans(
      bag_id,bhs_uid,external_scan_id,source_system,status,images
    ) VALUES('${scanBag.bagId}','0000003150','SCAN-DUP-3150','PHASE2_LOAD_HBSS','PENDING','[]'::jsonb)
    ON CONFLICT (source_system,external_scan_id) WHERE external_scan_id IS NOT NULL DO NOTHING`;
    await Promise.all(Array.from({ length: 50 }, () => database.executeAsync(duplicateScan)));
    assert.equal(
      database.execute(
        "SELECT count(*) FROM public.xray_scans WHERE source_system='PHASE2_LOAD_HBSS' AND external_scan_id='SCAN-DUP-3150'",
      ),
      "1",
    );

    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        database.executeAsync(
          `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
           VALUES('${scanBag.bagId}','0000003150','SCAN-MULTI-${index}','PHASE2_LOAD_HBSS','PENDING','[]'::jsonb)`,
        ),
      ),
    );
    assert.equal(
      database.execute(
        "SELECT count(*) FROM public.xray_scans WHERE source_system='PHASE2_LOAD_HBSS'",
      ),
      "26",
    );

    const tagBags = [];
    for (let index = 0; index < 25; index += 1) {
      const uid = `0000032${String(index).padStart(3, "0")}`;
      tagBags.push(parseJsonOutput(database.execute(bhsSql(uid, 3200 + index))));
    }
    const assignments = await Promise.all(
      tagBags.map((bag, index) =>
        database.executeAsync(
          `SELECT public.assign_beltcon_rfid_tag_v1('${bag.bagId}','RFID-RACE-${index}','EPC-RACE-SHARED',NULL,(SELECT version FROM public.bags WHERE id='${bag.bagId}'),'load-actor','Operations Officer','load-tag-${index}')::text`,
        ),
      ),
    );
    const statuses = assignments.map((output) => parseJsonOutput(output).status);
    assert.equal(statuses.filter((status) => status === "ASSIGNED").length, 1);
    assert.equal(statuses.filter((status) => status === "DUPLICATE_EPC").length, 24);
    assert.equal(
      database.execute("SELECT count(*) FROM public.tags WHERE epc='EPC-RACE-SHARED'"),
      "1",
    );
    context.diagnostic(
      JSON.stringify({
        clients: 100,
        duplicateScanRows: 1,
        differentScanRows: 25,
        tagAssignments: 1,
        tagConflicts: 24,
        deadlocks: 0,
        durationMs: Date.now() - startedAt,
      }),
    );
  });

  test("P2-DB-018 and P2-DB-021 station delivery rejects cross-station and cross-site claims", () => {
    const first = parseJsonOutput(
      database.execute(
        stationSql({
          bhsUid: "0000003107",
          suffix: 3107,
          stationId: "TAG-A",
          siteId: "SITE-A",
        }),
      ),
    );
    const conflict = parseJsonOutput(
      database.execute(
        stationSql({
          bhsUid: "0000003107",
          suffix: 3107,
          stationId: "TAG-B",
          siteId: "SITE-B",
        }),
      ),
    );
    assert.equal(first.status, "ACCEPTED");
    assert.equal(conflict.errorCode, "STATION_BINDING_CONFLICT");
    assert.equal(
      database.execute(
        "SELECT site_id||':'||station_id FROM public.screening_integration_events WHERE event_id='00000000-0000-4000-8000-000000003107'",
      ),
      "SITE-A:TAG-A",
    );
  });

  test("P2-DB-020 service-role execution is allowed while authenticated mutation is revoked", () => {
    assert.equal(
      database.execute("SELECT has_table_privilege('authenticated','public.bags','INSERT')"),
      "f",
    );
    assert.equal(
      database.execute("SELECT has_table_privilege('service_role','public.bags','INSERT')"),
      "t",
    );
    assert.equal(
      database.execute(
        "SELECT has_function_privilege('service_role','public.ingest_beltcon_bhs_message_v2(jsonb,text,text,text,uuid,text)','EXECUTE')",
      ),
      "t",
    );
    const output = database.execute(
      `BEGIN; SET LOCAL ROLE service_role; ${bhsSql("0000003108", 3108)}; COMMIT`,
    );
    assert.equal(parseJsonOutput(output).status, "ACCEPTED");
  });

  test("P2-DB-022 audit history is append-only for authenticated and administrator profiles", () => {
    database.execute(
      "INSERT INTO public.audit_events(action,actor_type,outcome,metadata) VALUES('P2_AUDIT','SYSTEM','SUCCESS','{}')",
      { tuplesOnly: false },
    );
    const originalTimestamp = database.execute(
      "SELECT created_at::text FROM public.audit_events WHERE action='P2_AUDIT'",
    );
    for (const sql of [
      "UPDATE public.audit_events SET outcome='ALTERED' WHERE action='P2_AUDIT'",
      "DELETE FROM public.audit_events WHERE action='P2_AUDIT'",
    ])
      assert.throws(
        () =>
          database.execute(`BEGIN; SET LOCAL ROLE authenticated; ${sql}; ROLLBACK`, {
            tuplesOnly: false,
          }),
        /permission denied|row-level security|immutable/i,
      );
    assert.equal(
      database.execute("SELECT outcome FROM public.audit_events WHERE action='P2_AUDIT'"),
      "SUCCESS",
    );
    assert.equal(
      database.execute("SELECT created_at::text FROM public.audit_events WHERE action='P2_AUDIT'"),
      originalTimestamp,
    );
    assert.throws(
      () =>
        database.execute(
          "BEGIN; SET LOCAL ROLE service_role; UPDATE public.audit_events SET outcome='ALTERED' WHERE action='P2_AUDIT'; ROLLBACK",
          { tuplesOnly: false },
        ),
      /permission denied|row-level security|immutable/i,
    );
  });

  test("P2-DB-026 statement timeout and deadlock abort atomically and permit bounded retry", async (context) => {
    await assert.rejects(
      () =>
        database.executeAsync(
          `BEGIN;
           SET LOCAL statement_timeout='50ms';
           INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone)
           VALUES('ETB-TIMEOUT','0000003301','0123456789','SV1','PHASE2_FAILURE','IDENTIFIED','TAGGING_STATION');
           SELECT pg_sleep(0.2);
           COMMIT;`,
        ),
      /statement timeout|canceling statement/i,
    );
    assert.equal(database.execute("SELECT count(*) FROM public.bags WHERE id='ETB-TIMEOUT'"), "0");

    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone) VALUES
       ('ETB-DEADLOCK-A','0000003302','0123456789','SV1','PHASE2_FAILURE','IDENTIFIED','TAGGING_STATION'),
       ('ETB-DEADLOCK-B','0000003303','0123456789','SV1','PHASE2_FAILURE','IDENTIFIED','TAGGING_STATION')`,
      { tuplesOnly: false },
    );
    const contenders = await Promise.allSettled([
      database.executeAsync(
        `BEGIN; UPDATE public.bags SET version=version+1 WHERE id='ETB-DEADLOCK-A';
         SELECT pg_sleep(0.2); UPDATE public.bags SET version=version+1 WHERE id='ETB-DEADLOCK-B'; COMMIT;`,
      ),
      database.executeAsync(
        `BEGIN; UPDATE public.bags SET version=version+1 WHERE id='ETB-DEADLOCK-B';
         SELECT pg_sleep(0.2); UPDATE public.bags SET version=version+1 WHERE id='ETB-DEADLOCK-A'; COMMIT;`,
      ),
    ]);
    assert.equal(contenders.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(contenders.filter((result) => result.status === "rejected").length, 1);
    assert.match(
      contenders.find((result) => result.status === "rejected").reason.message,
      /deadlock detected/i,
    );
    database.execute(
      `BEGIN; SET LOCAL lock_timeout='1s';
       UPDATE public.bags SET version=version+1 WHERE id IN ('ETB-DEADLOCK-A','ETB-DEADLOCK-B'); COMMIT;`,
      { tuplesOnly: false },
    );
    assert.equal(
      database.execute(
        "SELECT count(*) FROM public.bags WHERE id IN ('ETB-DEADLOCK-A','ETB-DEADLOCK-B')",
      ),
      "2",
    );
    context.diagnostic(JSON.stringify({ deadlocks: 1, retries: 1, finalRows: 2 }));
  });

  test("P2-DB-030 Phase 2 traceability and limitation registers cover every required ID", async () => {
    const [traceability, limitations] = await Promise.all([
      readFile(
        path.join(repositoryRoot, "docs", "testing", "SBTS-PHASE-2-REQUIREMENTS-TRACEABILITY.md"),
        "utf8",
      ),
      readFile(
        path.join(repositoryRoot, "docs", "testing", "SBTS-PHASE-2-LIMITATION-REGISTER.md"),
        "utf8",
      ),
    ]);
    for (let sequence = 1; sequence <= 30; sequence += 1)
      assert.match(traceability, new RegExp(`P2-DB-${String(sequence).padStart(3, "0")}`));
    for (let sequence = 1; sequence <= 20; sequence += 1)
      assert.match(traceability, new RegExp(`FAT-SW-${String(sequence).padStart(3, "0")}`));
    for (let sequence = 1; sequence <= 17; sequence += 1)
      assert.match(limitations, new RegExp(`LIM-P2-${String(sequence).padStart(3, "0")}`));
    assert.match(limitations, /PostgreSQL 17\.10 local gate executes/);
  });
}
