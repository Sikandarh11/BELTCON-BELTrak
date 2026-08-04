import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresHarness,
  parseJsonOutput,
  postgresTestAvailability,
  sqlJson,
} from "./postgresHarness.mjs";

const availability = postgresTestAvailability();

if (!availability.available) {
  test(
    "disposable PostgreSQL BHS/HBSS integrity suite",
    {
      skip: availability.reason,
    },
    () => {},
  );
} else {
  const database = createPostgresHarness(availability.databaseUrl, {
    psqlPath: availability.psqlPath,
  });
  test.before(async () => database.migrateClean());
  test.beforeEach(() => database.resetOperationalData());

  const hash = (character) => character.repeat(64);
  const eventUuid = (sequence) => `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  const bhsMessage = (bhsUid, evaluation = "R", lineId = "L1") => ({
    messageType: 2001,
    trigger: 1,
    lineId,
    bhsUid,
    evaluation,
  });
  const bhsSql = ({
    bhsUid,
    evaluation = "R",
    lineId = "L1",
    sourceSystem = "TEST_BHS",
    fingerprint = `FP-${bhsUid}-${evaluation}-${lineId}`,
    payloadHash = hash("a"),
    eventId = "00000000-0000-4000-8000-000000000101",
    requestId = "pg-test",
  }) =>
    `SELECT public.ingest_beltcon_bhs_message_v2(${sqlJson(
      bhsMessage(bhsUid, evaluation, lineId),
    )},'${sourceSystem}','${fingerprint}','${payloadHash}','${eventId}'::uuid,'${requestId}')::text`;
  const stationBhsSql = ({
    bhsUid,
    stationId = "TAG-STATION-01",
    siteId = "ALWAJH",
    sourceSystem = "TEST_STATION_BHS",
    fingerprint = `STATION-FP-${bhsUid}`,
    eventId = "00000000-0000-4000-8000-000000000151",
  }) =>
    `SELECT public.ingest_beltcon_bhs_station_message_v1(${sqlJson(
      bhsMessage(bhsUid),
    )},'${sourceSystem}','${fingerprint}','${hash("c")}','${eventId}'::uuid,'station-pg-test','${stationId}','${siteId}')::text`;

  const screeningEvent = ({
    bhsUid,
    eventId = "00000000-0000-4000-8000-000000000201",
    externalScanId = "SCAN-201",
    sourceSystem = "TEST_HBSS",
  }) => ({
    schemaVersion: 1,
    eventId,
    eventType: "BAG_SUSPECTED",
    sourceSystem,
    occurredAt: "2026-07-30T10:00:00.000Z",
    bag: {
      bhsUid,
      iataCode: "0123456789",
      iataOrigin: "RUH",
      flightNo: "SV241",
      passengerName: "Postgres Test",
    },
    screening: {
      evaluationRaw: "R",
      station: "HBSS-TEST-01",
      screenedAt: "2026-07-30T09:59:00.000Z",
    },
    threat: { type: "TEST_THREAT", level: 3 },
    scan: {
      externalScanId,
      status: "AVAILABLE",
      images: [
        {
          imageId: "SIDE-01",
          label: "Side view",
          imageRef: "/mock-xray/test/side.jpg",
          mimeType: "image/jpeg",
        },
      ],
    },
  });
  const screeningSql = (input, payloadHash = hash("b")) =>
    `SELECT public.ingest_screening_suspect_event_v2(${sqlJson(
      screeningEvent(input),
    )},'${payloadHash}','pg-test')::text`;

  test("P2-DB-004 BHS ACCEPT records one event and creates no bag", () => {
    const result = parseJsonOutput(
      database.execute(bhsSql({ bhsUid: "0000000101", evaluation: "A" })),
    );
    assert.equal(result.status, "ACCEPTED");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.rfid_events"), "0");
    assert.equal(
      database.execute(
        "SELECT acknowledgement_outcome||':'||acknowledgement_timing FROM public.screening_integration_events",
      ),
      "ACCEPTED:AFTER_DURABLE_COMMIT",
    );
  });

  test("P2-DB-005 and P2-DB-006 BHS REJECT is idempotent and satisfies the Al Wajh base policy", () => {
    const command = bhsSql({ bhsUid: "0000000102" });
    const first = parseJsonOutput(database.execute(command));
    const duplicate = parseJsonOutput(database.execute(command));
    assert.equal(first.status, "ACCEPTED");
    assert.equal(first.canAssignTag, true);
    assert.equal(first.taggingReadinessStatus, "READY_FOR_TAGGING");
    assert.equal(duplicate.status, "DUPLICATE");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "READY_FOR_TAGGING",
    );
    assert.equal(
      database.execute(
        "SELECT bhs_uid||':'||bhs_line_id||':'||screening_evaluation_raw||':'||screening_evaluation||':'||source_system FROM public.bags",
      ),
      "0000000102:L1:R:REJECT:TEST_BHS",
    );
    assert.equal(
      database.execute(
        "SELECT bhs_confirmed_at IS NOT NULL AND created_at IS NOT NULL FROM public.bags",
      ),
      "t",
    );
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.rfid_events"), "0");
  });

  test("P2-DB-018 station synchronization metadata is durable and binding-safe", () => {
    const command = stationBhsSql({ bhsUid: "0000000151" });
    const first = parseJsonOutput(database.execute(command));
    const duplicate = parseJsonOutput(database.execute(command));
    assert.equal(first.status, "ACCEPTED");
    assert.equal(duplicate.status, "DUPLICATE");
    assert.equal(first.stationId, "TAG-STATION-01");
    assert.equal(
      database.execute(
        "SELECT station_id||':'||site_id||':'||(station_synchronized_at IS NOT NULL)::text FROM public.screening_integration_events WHERE event_id='00000000-0000-4000-8000-000000000151'",
      ),
      "TAG-STATION-01:ALWAJH:true",
    );
    const conflict = parseJsonOutput(
      database.execute(stationBhsSql({ bhsUid: "0000000151", stationId: "TAG-STATION-02" })),
    );
    assert.equal(conflict.status, "CONFLICT");
    assert.equal(conflict.errorCode, "STATION_BINDING_CONFLICT");
    assert.equal(
      database.execute(
        "SELECT station_id FROM public.screening_integration_events WHERE event_id='00000000-0000-4000-8000-000000000151'",
      ),
      "TAG-STATION-01",
    );
  });

  test("P2-DB-019 HBSS recall survives retry and transaction rollback", () => {
    const actor = "00000000-0000-4000-8000-000000000551";
    database.execute(
      `INSERT INTO auth.users(id,email) VALUES('${actor}','recall@test.invalid') ON CONFLICT DO NOTHING;
       INSERT INTO public.profiles(id,first_name,last_name,email,role)
       VALUES('${actor}','Recall','Officer','recall@test.invalid','Operations Officer')
       ON CONFLICT(id) DO NOTHING;
       INSERT INTO public.bags(id,bhs_uid,iata_code,flight,status,current_zone)
       VALUES('ETB-RECALL-PG','0000000551','0123456789','SV551','UNDER_RECHECK','RECHECK-STATION-01');
       INSERT INTO public.alarms(id,bag_id,zone,outcome,opened_at,sent_to_recheck_at)
       VALUES('ALARM-RECALL-PG','ETB-RECALL-PG','CUSTOMS_EXIT','SENT_TO_RECHECK',NOW(),NOW());`,
      { tuplesOnly: false },
    );
    const begin = `SELECT public.begin_beltcon_hbss_recall_v1(
      'ETB-RECALL-PG','ALARM-RECALL-PG',1,1,'${actor}'::uuid,'RECHECK-STATION-01',
      'SIMULATED','recall-idempotency-551','recall-request-551')::text`;
    const created = parseJsonOutput(database.execute(begin));
    const duplicate = parseJsonOutput(database.execute(begin));
    assert.equal(created.status, "CREATED");
    assert.equal(duplicate.status, "DUPLICATE");
    assert.equal(created.recall.id, duplicate.recall.id);
    assert.equal(database.execute("SELECT count(*) FROM public.hbss_recall_requests"), "1");
    database.execute(
      `BEGIN;
       SELECT public.begin_beltcon_hbss_recall_v1(
         'ETB-RECALL-PG','ALARM-RECALL-PG',1,1,'${actor}'::uuid,'RECHECK-STATION-01',
         'SIMULATED','rollback-recall-551','rollback-request-551');
       ROLLBACK;`,
      { tuplesOnly: false },
    );
    assert.equal(database.execute("SELECT count(*) FROM public.hbss_recall_requests"), "1");
    const completed = parseJsonOutput(
      database.execute(
        `SELECT public.complete_beltcon_hbss_recall_v1(
          '${created.recall.id}'::uuid,'REQUEST_SENT',NULL,NULL,'{}'::jsonb,'recall-complete-551')::text`,
      ),
    );
    assert.equal(completed.status, "UPDATED");
    assert.equal(
      database.execute(
        "SELECT status||':'||station_id FROM public.hbss_recall_requests WHERE bag_id='ETB-RECALL-PG'",
      ),
      "REQUEST_SENT:RECHECK-STATION-01",
    );
  });

  test("P2-DB-007 concurrent duplicate BHS ingestion has one authoritative bag and event", async () => {
    const command = bhsSql({ bhsUid: "0000000103" });
    const outputs = await Promise.all([
      database.executeAsync(command),
      database.executeAsync(command),
    ]);
    assert.deepEqual(outputs.map((output) => parseJsonOutput(output).status).sort(), [
      "ACCEPTED",
      "DUPLICATE",
    ]);
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "1");
  });

  test("P2-DB-014 HBSS-first bag is confirmed without changing its internal bag ID", () => {
    const screening = parseJsonOutput(database.execute(screeningSql({ bhsUid: "0000000104" })));
    const originalId = screening.bagId;
    const bhs = parseJsonOutput(
      database.execute(
        bhsSql({
          bhsUid: "0000000104",
          fingerprint: "FP-HBSS-FIRST-104",
          eventId: "00000000-0000-4000-8000-000000000104",
        }),
      ),
    );
    assert.equal(bhs.bagId, originalId);
    assert.equal(bhs.canAssignTag, true);
    assert.equal(bhs.taggingReadinessStatus, "READY_FOR_TAGGING");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "READY_FOR_TAGGING",
    );
  });

  test("P2-DB-008 HBSS suspect followed by BHS ACCEPT becomes a sticky blocked conflict", () => {
    const screening = parseJsonOutput(database.execute(screeningSql({ bhsUid: "0000000105" })));
    const bhs = parseJsonOutput(
      database.execute(
        bhsSql({
          bhsUid: "0000000105",
          evaluation: "A",
          fingerprint: "FP-CONFLICT-105",
          eventId: "00000000-0000-4000-8000-000000000105",
        }),
      ),
    );
    assert.equal(bhs.status, "CONFLICT");
    assert.equal(bhs.bagId, screening.bagId);
    assert.equal(bhs.canAssignTag, false);
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "BLOCKED_CONFLICT",
    );
    database.execute("UPDATE public.xray_scans SET updated_at=NOW()", { tuplesOnly: false });
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "BLOCKED_CONFLICT",
    );
  });

  test("invalid BHS UID does not create a bag or integration event", () => {
    const result = parseJsonOutput(
      database.execute(bhsSql({ bhsUid: "123456789", fingerprint: "FP-INVALID" })),
    );
    assert.equal(result.status, "FAILED");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "0");
  });

  test("P2-BHS-002 PostgreSQL persists every supported non-ACCEPT evaluation exactly", () => {
    const cases = [
      ["R", "REJECT"],
      ["T", "TIMEOUT"],
      ["N", "NO_DECISION"],
      ["?", "MISTRACK"],
    ];
    for (const [index, [raw, normalized]] of cases.entries()) {
      const bhsUid = `000001100${index}`;
      const result = parseJsonOutput(
        database.execute(
          bhsSql({
            bhsUid,
            evaluation: raw,
            fingerprint: `FP-EVALUATION-${raw}-${index}`,
            eventId: eventUuid(1100 + index),
          }),
        ),
      );
      assert.equal(result.status, "ACCEPTED");
      assert.equal(result.evaluation, normalized);
      assert.equal(result.canAssignTag, true);
      assert.equal(result.taggingReadinessStatus, "READY_FOR_TAGGING");
      assert.equal(
        database.execute(
          `SELECT screening_evaluation_raw||':'||screening_evaluation FROM public.bags WHERE bhs_uid='${bhsUid}'`,
        ),
        `${raw}:${normalized}`,
      );
    }
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "4");
  });

  test("P2-BHS-006 similar messages keep one physical identity and record deterministic conflicts", () => {
    const first = parseJsonOutput(
      database.execute(
        bhsSql({
          bhsUid: "0000011200",
          fingerprint: "FP-SIMILAR-FIRST",
          eventId: eventUuid(1120),
        }),
      ),
    );
    const lineConflict = parseJsonOutput(
      database.execute(
        bhsSql({
          bhsUid: "0000011200",
          lineId: "L2",
          fingerprint: "FP-SIMILAR-LINE",
          eventId: eventUuid(1121),
        }),
      ),
    );
    const evaluationConflict = parseJsonOutput(
      database.execute(
        bhsSql({
          bhsUid: "0000011200",
          evaluation: "T",
          fingerprint: "FP-SIMILAR-EVALUATION",
          eventId: eventUuid(1122),
        }),
      ),
    );
    assert.equal(first.status, "ACCEPTED");
    assert.equal(lineConflict.status, "CONFLICT");
    assert.equal(evaluationConflict.status, "CONFLICT");
    assert.equal(lineConflict.bagId, first.bagId);
    assert.equal(evaluationConflict.bagId, first.bagId);
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "3");
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "BLOCKED_CONFLICT",
    );
  });

  test("P2-BHS-007 and P2-BHS-008 opposite evaluations block in either receipt order", () => {
    for (const [index, evaluations] of [
      [0, ["R", "A"]],
      [1, ["A", "R"]],
    ]) {
      const bhsUid = `00000113${index}0`;
      const results = evaluations.map((evaluation, order) =>
        parseJsonOutput(
          database.execute(
            bhsSql({
              bhsUid,
              evaluation,
              fingerprint: `FP-ORDER-${index}-${evaluation}`,
              eventId: eventUuid(1130 + index * 2 + order),
            }),
          ),
        ),
      );
      assert.deepEqual(results.map((result) => result.status).sort(), ["ACCEPTED", "CONFLICT"]);
      assert.equal(
        database.execute(
          `SELECT tagging_readiness_status FROM public.bags WHERE bhs_uid='${bhsUid}'`,
        ),
        "BLOCKED_CONFLICT",
      );
      assert.equal(
        database.execute(`SELECT count(*) FROM public.bags WHERE bhs_uid='${bhsUid}'`),
        "1",
      );
      assert.equal(
        database.execute(
          `SELECT count(*) FROM public.audit_events
           WHERE action='BHS_DIVERSION_CONFIRMED' AND metadata->>'bhsUid'='${bhsUid}'`,
        ),
        index === 0 ? "1" : "0",
      );
    }
  });

  test("P2-DB-027 repeated PostgreSQL duplicate concurrency stays singular", async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const bhsUid = `0000012${String(iteration).padStart(3, "0")}`;
      const command = bhsSql({
        bhsUid,
        fingerprint: `FP-CONCURRENT-DUPLICATE-${iteration}`,
        eventId: eventUuid(1200 + iteration),
      });
      const outputs = await Promise.all([
        database.executeAsync(command),
        database.executeAsync(command),
      ]);
      assert.deepEqual(outputs.map((output) => parseJsonOutput(output).status).sort(), [
        "ACCEPTED",
        "DUPLICATE",
      ]);
    }
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "10");
    assert.equal(
      database.execute("SELECT count(*) FROM public.screening_integration_events"),
      "10",
    );
  });

  test("P2-DB-027 concurrent ACCEPT and REJECT has one deterministic blocked bag", async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const bhsUid = `0000013${String(iteration).padStart(3, "0")}`;
      const outputs = await Promise.all([
        database.executeAsync(
          bhsSql({
            bhsUid,
            evaluation: "A",
            fingerprint: `FP-CONCURRENT-A-${iteration}`,
            eventId: eventUuid(1300 + iteration * 2),
          }),
        ),
        database.executeAsync(
          bhsSql({
            bhsUid,
            evaluation: "R",
            fingerprint: `FP-CONCURRENT-R-${iteration}`,
            eventId: eventUuid(1301 + iteration * 2),
          }),
        ),
      ]);
      assert.deepEqual(outputs.map((output) => parseJsonOutput(output).status).sort(), [
        "ACCEPTED",
        "CONFLICT",
      ]);
      assert.equal(
        database.execute(
          `SELECT tagging_readiness_status FROM public.bags WHERE bhs_uid='${bhsUid}'`,
        ),
        "BLOCKED_CONFLICT",
      );
    }
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "10");
    assert.equal(
      database.execute("SELECT count(*) FROM public.screening_integration_events"),
      "20",
    );
  });

  test("P2-DB-027 concurrent different BagIDs do not share a global identity lock", async () => {
    const startedAt = Date.now();
    const outputs = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        database.executeAsync(
          bhsSql({
            bhsUid: String(3_000_000_000 + index),
            fingerprint: `FP-INDEPENDENT-${index}`,
            eventId: eventUuid(1400 + index),
          }),
        ),
      ),
    );
    assert.equal(
      outputs.every((output) => parseJsonOutput(output).status === "ACCEPTED"),
      true,
    );
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "50");
    assert.equal(
      database.execute("SELECT count(*) FROM public.screening_integration_events"),
      "50",
    );
    assert.ok(Date.now() - startedAt < 30_000);
  });

  test("P2-DB-023 BHS transaction fault injection leaves only sanitized failure audit", () => {
    const cases = [
      {
        name: "integration-event-insert",
        table: "public.screening_integration_events",
        timing: "BEFORE INSERT",
        condition: "TRUE",
      },
      {
        name: "bag-insert",
        table: "public.bags",
        timing: "BEFORE INSERT",
        condition: "TRUE",
      },
      {
        name: "readiness-calculation",
        table: "public.audit_events",
        timing: "BEFORE INSERT",
        condition: "NEW.action = 'BAG_TAGGING_READINESS_CHANGED'",
      },
      {
        name: "semantic-response-persistence",
        table: "public.screening_integration_events",
        timing: "BEFORE UPDATE",
        condition: "NEW.acknowledgement_outcome IS NOT NULL",
      },
    ];

    for (const [index, failure] of cases.entries()) {
      const functionName = `fail_test_bhs_${index}`;
      const triggerName = `fail_test_bhs_${index}`;
      database.execute(
        `CREATE OR REPLACE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN IF ${failure.condition} THEN RAISE EXCEPTION 'forced ${failure.name} failure'; END IF; RETURN NEW; END $$;
         CREATE TRIGGER ${triggerName} ${failure.timing} ON ${failure.table}
         FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`,
        { tuplesOnly: false },
      );
      try {
        const result = parseJsonOutput(
          database.execute(
            bhsSql({
              bhsUid: `000001500${index}`,
              fingerprint: `FP-FAILURE-${index}`,
              eventId: eventUuid(1500 + index),
            }),
          ),
        );
        assert.equal(result.status, "FAILED");
        assert.equal(result.errorCode, "BHS_PROCESSING_FAILED");
        assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
        assert.equal(
          database.execute("SELECT count(*) FROM public.screening_integration_events"),
          "0",
        );
        assert.equal(
          database.execute(
            "SELECT count(*) FROM public.audit_events WHERE action='BHS_MESSAGE_FAILED'",
          ),
          "1",
        );
      } finally {
        database.execute(
          `DROP TRIGGER IF EXISTS ${triggerName} ON ${failure.table}; DROP FUNCTION IF EXISTS public.${functionName}()`,
          { tuplesOnly: false },
        );
        database.resetOperationalData();
      }
    }
  });

  test("P2-BHS-011 bag-update failure preserves an existing HBSS-first bag", () => {
    const screening = parseJsonOutput(
      database.execute(
        screeningSql({
          bhsUid: "0000011520",
          eventId: eventUuid(1520),
          externalScanId: "SCAN-BAG-UPDATE-FAILURE",
        }),
      ),
    );
    const versionBefore = database.execute(
      `SELECT version FROM public.bags WHERE id='${screening.bagId}'`,
    );
    database.execute(
      `CREATE OR REPLACE FUNCTION public.fail_test_bhs_bag_update() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'forced bag update failure'; END $$;
       CREATE TRIGGER fail_test_bhs_bag_update BEFORE UPDATE ON public.bags
       FOR EACH ROW EXECUTE FUNCTION public.fail_test_bhs_bag_update()`,
      { tuplesOnly: false },
    );
    try {
      const result = parseJsonOutput(
        database.execute(
          bhsSql({
            bhsUid: "0000011520",
            fingerprint: "FP-BAG-UPDATE-FAILURE",
            eventId: eventUuid(1521),
          }),
        ),
      );
      assert.equal(result.status, "FAILED");
      assert.equal(
        database.execute(`SELECT version FROM public.bags WHERE id='${screening.bagId}'`),
        versionBefore,
      );
      assert.equal(
        database.execute(
          `SELECT bhs_confirmation_status FROM public.bags WHERE id='${screening.bagId}'`,
        ),
        "AWAITING_BHS_CONFIRMATION",
      );
      assert.equal(
        database.execute(
          "SELECT count(*) FROM public.screening_integration_events WHERE event_type='BHS_MESSAGE'",
        ),
        "0",
      );
      assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    } finally {
      database.execute(
        "DROP TRIGGER IF EXISTS fail_test_bhs_bag_update ON public.bags; DROP FUNCTION IF EXISTS public.fail_test_bhs_bag_update()",
        { tuplesOnly: false },
      );
    }
  });

  test("P2-BHS-011 audit failure aborts all domain mutation without false success", () => {
    database.execute(
      `CREATE OR REPLACE FUNCTION public.fail_test_bhs_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'forced audit failure'; END $$;
       CREATE TRIGGER fail_test_bhs_audit BEFORE INSERT ON public.audit_events
       FOR EACH ROW EXECUTE FUNCTION public.fail_test_bhs_audit()`,
      { tuplesOnly: false },
    );
    try {
      assert.throws(
        () =>
          database.execute(
            bhsSql({
              bhsUid: "0000011510",
              fingerprint: "FP-AUDIT-FAILURE",
              eventId: eventUuid(1510),
            }),
          ),
        /forced audit failure/i,
      );
      assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
      assert.equal(
        database.execute("SELECT count(*) FROM public.screening_integration_events"),
        "0",
      );
    } finally {
      database.execute(
        "DROP TRIGGER IF EXISTS fail_test_bhs_audit ON public.audit_events; DROP FUNCTION IF EXISTS public.fail_test_bhs_audit()",
        { tuplesOnly: false },
      );
    }
  });

  test("P2-DB-024 rollback before commit and lost response after commit are safe to retry", () => {
    const rollbackCommand = bhsSql({
      bhsUid: "0000011600",
      fingerprint: "FP-ROLLBACK-BEFORE-COMMIT",
      eventId: eventUuid(1600),
    });
    database.execute(`BEGIN; ${rollbackCommand}; ROLLBACK`, { tuplesOnly: false });
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "0");

    const lostResponseCommand = bhsSql({
      bhsUid: "0000011601",
      fingerprint: "FP-LOST-RESPONSE",
      eventId: eventUuid(1601),
    });
    database.execute(lostResponseCommand);
    const retry = parseJsonOutput(database.execute(lostResponseCommand));
    assert.equal(retry.status, "DUPLICATE");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "1");
  });

  test("P2-BHS-018 late messages preserve tagged, alarmed, and resolved lifecycle evidence", () => {
    for (const [index, status] of ["TAGGED", "ALARMED", "RESOLVED"].entries()) {
      const bhsUid = `000001170${index}`;
      const bagId = `ETB-LIFECYCLE-${index}`;
      database.execute(
        `INSERT INTO public.bags(
           id,bhs_uid,bhs_line_id,screening_evaluation_raw,screening_evaluation,
           bhs_confirmation_status,bhs_confirmed_at,source_system,status,current_zone,
           epc,rfid_tag_barcode
         ) VALUES(
           '${bagId}','${bhsUid}','L1','R','REJECT','CONFIRMED',NOW(),'TEST_BHS',
           '${status}','TAGGING_STATION','EPC-HISTORICAL-${index}','TAG-HISTORICAL-${index}'
         )`,
        { tuplesOnly: false },
      );
      const result = parseJsonOutput(
        database.execute(
          bhsSql({
            bhsUid,
            evaluation: "A",
            fingerprint: `FP-LIFECYCLE-${index}`,
            eventId: eventUuid(1700 + index),
          }),
        ),
      );
      assert.equal(result.status, "CONFLICT");
      assert.equal(
        database.execute(
          `SELECT status||':'||epc||':'||rfid_tag_barcode||':'||tagging_readiness_status FROM public.bags WHERE id='${bagId}'`,
        ),
        `${status}:EPC-HISTORICAL-${index}:TAG-HISTORICAL-${index}:BLOCKED_CONFLICT`,
      );
    }
  });

  test("P2-BHS-006 exact case-sensitive BagIDs remain distinct", () => {
    for (const [index, bhsUid] of ["ABC1234567", "abc1234567"].entries()) {
      const result = parseJsonOutput(
        database.execute(
          bhsSql({
            bhsUid,
            fingerprint: `FP-CASE-${index}`,
            eventId: eventUuid(1800 + index),
          }),
        ),
      );
      assert.equal(result.status, "ACCEPTED");
    }
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "2");
    assert.equal(database.execute("SELECT count(DISTINCT bhs_uid) FROM public.bags"), "2");
  });

  test("P2-DB-009 screening creates its bag, X-ray, and integration event atomically", () => {
    const result = parseJsonOutput(database.execute(screeningSql({ bhsUid: "0000000201" })));
    assert.equal(result.status, "ACCEPTED");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "1");
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "AWAITING_BHS",
    );
  });

  function seedConflictingScan(ownerUid, externalScanId) {
    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone)
       VALUES('ETB-SCAN-OWNER','${ownerUid}','0123456789','SV1','TEST_HBSS','IDENTIFIED','TAGGING_STATION');
       INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
       VALUES('ETB-SCAN-OWNER','${ownerUid}','${externalScanId}','TEST_HBSS','AVAILABLE','[{"id":"1","label":"Side","url":"/mock-xray/test/side.jpg","mimeType":"image/jpeg"}]'::jsonb)`,
      { tuplesOnly: false },
    );
  }

  test("P2-DB-010 external scan conflict rolls back new bag creation", () => {
    seedConflictingScan("0000000299", "SCAN-CONFLICT");
    const result = parseJsonOutput(
      database.execute(screeningSql({ bhsUid: "0000000202", externalScanId: "SCAN-CONFLICT" })),
    );
    assert.equal(result.status, "CONFLICT");
    assert.equal(
      database.execute("SELECT count(*) FROM public.bags WHERE bhs_uid='0000000202'"),
      "0",
    );
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "0");
  });

  test("external scan conflict rolls back an existing bag update", () => {
    database.execute(
      bhsSql({
        bhsUid: "0000000203",
        fingerprint: "FP-BHS-203",
        eventId: "00000000-0000-4000-8000-000000000203",
      }),
    );
    seedConflictingScan("0000000299", "SCAN-CONFLICT-EXISTING");
    const version = database.execute("SELECT version FROM public.bags WHERE bhs_uid='0000000203'");
    const result = parseJsonOutput(
      database.execute(
        screeningSql({
          bhsUid: "0000000203",
          eventId: "00000000-0000-4000-8000-000000000204",
          externalScanId: "SCAN-CONFLICT-EXISTING",
        }),
      ),
    );
    assert.equal(result.status, "CONFLICT");
    assert.equal(
      database.execute(
        "SELECT screening_received_at IS NULL FROM public.bags WHERE bhs_uid='0000000203'",
      ),
      "t",
    );
    assert.equal(
      database.execute("SELECT version FROM public.bags WHERE bhs_uid='0000000203'"),
      version,
    );
  });

  test("P2-DB-011 wrong scan BHS UID rolls back everything", () => {
    seedConflictingScan("0000000298", "SCAN-WRONG-BHS");
    const result = parseJsonOutput(
      database.execute(screeningSql({ bhsUid: "0000000204", externalScanId: "SCAN-WRONG-BHS" })),
    );
    assert.equal(result.errorCode, "BHS_UID_MISMATCH");
    assert.equal(
      database.execute("SELECT count(*) FROM public.bags WHERE bhs_uid='0000000204'"),
      "0",
    );
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "0");
  });

  test("X-ray insert failure rolls back bag and integration event", () => {
    database.execute(
      `CREATE OR REPLACE FUNCTION public.fail_test_xray_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced xray failure'; END $$;
       CREATE TRIGGER fail_test_xray_insert BEFORE INSERT ON public.xray_scans FOR EACH ROW EXECUTE FUNCTION public.fail_test_xray_insert()`,
      { tuplesOnly: false },
    );
    try {
      const result = parseJsonOutput(database.execute(screeningSql({ bhsUid: "0000000205" })));
      assert.equal(result.status, "FAILED");
      assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
      assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "0");
      assert.equal(
        database.execute("SELECT count(*) FROM public.screening_integration_events"),
        "0",
      );
    } finally {
      database.execute(
        "DROP TRIGGER IF EXISTS fail_test_xray_insert ON public.xray_scans; DROP FUNCTION IF EXISTS public.fail_test_xray_insert()",
        { tuplesOnly: false },
      );
    }
  });

  test("integration event insert failure rolls back bag and X-ray and retry succeeds", () => {
    database.execute(
      `CREATE OR REPLACE FUNCTION public.fail_test_integration_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced integration failure'; END $$;
       CREATE TRIGGER fail_test_integration_insert BEFORE INSERT ON public.screening_integration_events FOR EACH ROW EXECUTE FUNCTION public.fail_test_integration_insert()`,
      { tuplesOnly: false },
    );
    const command = screeningSql({ bhsUid: "0000000206" });
    const failed = parseJsonOutput(database.execute(command));
    assert.equal(failed.status, "FAILED");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "0");
    database.execute(
      "DROP TRIGGER fail_test_integration_insert ON public.screening_integration_events; DROP FUNCTION public.fail_test_integration_insert()",
      { tuplesOnly: false },
    );
    const retried = parseJsonOutput(database.execute(command));
    assert.equal(retried.status, "ACCEPTED");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
  });

  test("concurrent duplicate screening event produces one authoritative result", async () => {
    const command = screeningSql({ bhsUid: "0000000207" });
    const outputs = await Promise.all([
      database.executeAsync(command),
      database.executeAsync(command),
    ]);
    assert.deepEqual(outputs.map((output) => parseJsonOutput(output).status).sort(), [
      "ACCEPTED",
      "DUPLICATE",
    ]);
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.screening_integration_events"), "1");
  });

  test("P2-DB-013 and P2-DB-015 concurrent BHS-first and HBSS-first paths converge on one internal bag", async () => {
    const bhs = bhsSql({
      bhsUid: "0000000208",
      fingerprint: "FP-CONVERGE-208",
      eventId: "00000000-0000-4000-8000-000000000208",
    });
    const screening = screeningSql({
      bhsUid: "0000000208",
      eventId: "00000000-0000-4000-8000-000000000209",
    });
    await Promise.all([database.executeAsync(bhs), database.executeAsync(screening)]);
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "READY_FOR_TAGGING",
    );
  });

  test("P2-DB-016 enhanced evidence is opt-in and base Al Wajh readiness does not require X-ray evidence", () => {
    database.execute(
      "UPDATE public.tagging_readiness_configuration SET policy='ENHANCED_EVIDENCE',updated_at=NOW() WHERE singleton=TRUE",
      { tuplesOnly: false },
    );
    database.execute(
      bhsSql({
        bhsUid: "0000000209",
        fingerprint: "FP-READY-209",
        eventId: "00000000-0000-4000-8000-000000000210",
      }),
    );
    database.execute(
      screeningSql({
        bhsUid: "0000000209",
        eventId: "00000000-0000-4000-8000-000000000211",
      }),
    );
    const bagId = database.execute("SELECT id FROM public.bags");
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "READY_FOR_TAGGING",
    );
    for (const column of [
      "screening_received_at",
      "screened_at",
      "screening_station",
      "threat_level",
      "threat_type",
    ]) {
      database.execute(`UPDATE public.bags SET ${column}=NULL WHERE id='${bagId}'`, {
        tuplesOnly: false,
      });
      assert.equal(
        database.execute("SELECT tagging_readiness_status FROM public.bags"),
        "AWAITING_SCREENING",
      );
      database.execute(
        column === "threat_level"
          ? `UPDATE public.bags SET threat_level=3 WHERE id='${bagId}'`
          : column.endsWith("_at")
            ? `UPDATE public.bags SET ${column}='2026-07-30T10:00:00Z' WHERE id='${bagId}'`
            : `UPDATE public.bags SET ${column}='TEST' WHERE id='${bagId}'`,
        { tuplesOnly: false },
      );
    }
    database.execute("UPDATE public.bags SET bhs_line_id=NULL WHERE id='" + bagId + "'", {
      tuplesOnly: false,
    });
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "AWAITING_BHS",
    );
    database.execute("UPDATE public.bags SET bhs_line_id='L1' WHERE id='" + bagId + "'", {
      tuplesOnly: false,
    });
    database.execute(
      "UPDATE public.bags SET bhs_confirmation_status=NULL WHERE id='" + bagId + "'",
      { tuplesOnly: false },
    );
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "AWAITING_BHS",
    );
    database.execute(
      "UPDATE public.bags SET bhs_confirmation_status='CONFIRMED' WHERE id='" + bagId + "'",
      { tuplesOnly: false },
    );
    database.execute(
      "UPDATE public.bags SET screening_evaluation_raw=NULL,screening_evaluation=NULL WHERE id='" +
        bagId +
        "'",
      { tuplesOnly: false },
    );
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "AWAITING_SCREENING",
    );
    database.execute(
      "UPDATE public.bags SET screening_evaluation_raw='R',screening_evaluation='REJECT' WHERE id='" +
        bagId +
        "'",
      { tuplesOnly: false },
    );
    database.execute(
      "UPDATE public.screening_integration_events SET processing_status='FAILED' WHERE event_type='BAG_SUSPECTED'",
      { tuplesOnly: false },
    );
    assert.equal(
      database.execute(`SELECT public.refresh_beltcon_tagging_readiness_v1('${bagId}')`),
      "AWAITING_SCREENING",
    );
    database.execute(
      "UPDATE public.screening_integration_events SET processing_status='ACCEPTED' WHERE event_type='BAG_SUSPECTED'",
      { tuplesOnly: false },
    );
    database.execute("UPDATE public.xray_scans SET status='PENDING', images='[]'::jsonb", {
      tuplesOnly: false,
    });
    assert.equal(
      database.execute("SELECT tagging_readiness_status FROM public.bags"),
      "AWAITING_XRAY",
    );
    const tagResult = parseJsonOutput(
      database.execute(
        `SELECT public.assign_beltcon_rfid_tag_v1('${bagId}','TAG-209','EPC-209',NULL,(SELECT version FROM public.bags WHERE id='${bagId}'),'actor','Operations Officer','pg-test')::text`,
      ),
    );
    assert.equal(tagResult.status, "TAG_ASSIGNMENT_NOT_READY");
    assert.ok(
      Number(
        database.execute(
          "SELECT count(*) FROM public.audit_events WHERE action='BAG_TAGGING_READINESS_CHANGED'",
        ),
      ) > 0,
    );
    database.execute(
      "UPDATE public.tagging_readiness_configuration SET policy='BASE_ALWAJH',updated_at=NOW() WHERE singleton=TRUE",
      { tuplesOnly: false },
    );
    assert.equal(
      database.execute(`SELECT public.refresh_beltcon_tagging_readiness_v1('${bagId}')`),
      "READY_FOR_TAGGING",
    );
    assert.equal(database.execute("SELECT iata_code IS NULL FROM public.bags"), "f");
    assert.equal(
      database.execute("SELECT count(*) FROM public.xray_scans WHERE status='AVAILABLE'"),
      "0",
    );
  });

  function asAuthenticated(sql) {
    return `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000999'; ${sql}; ROLLBACK`;
  }

  test("P2-DB-020 authenticated browser role cannot mutate operational or audit tables", () => {
    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone)
       VALUES('ETB-RLS','0000000301','0123456789','SV1','TEST','IDENTIFIED','TAGGING_STATION')`,
      { tuplesOnly: false },
    );
    for (const statement of [
      "INSERT INTO public.bags(id,bhs_uid,iata_code,flight) VALUES('ETB-RLS-2','0000000302','0123456789','SV1')",
      "UPDATE public.bags SET status='RESOLVED' WHERE id='ETB-RLS'",
      "UPDATE public.bags SET bhs_confirmation_status='CONFIRMED' WHERE id='ETB-RLS'",
      "UPDATE public.bags SET epc='EPC-BYPASS' WHERE id='ETB-RLS'",
      "INSERT INTO public.xray_scans(bag_id,bhs_uid,source_system,status) VALUES('ETB-RLS','0000000301','TEST','PENDING')",
      `INSERT INTO public.screening_integration_events(event_id,source_system,event_type,schema_version,payload_hash,processing_status) VALUES('00000000-0000-4000-8000-000000000301','TEST','BAG_SUSPECTED',1,'${hash("c")}','PROCESSING')`,
      "DELETE FROM public.audit_events",
    ]) {
      assert.throws(
        () => database.execute(asAuthenticated(statement)),
        /permission denied|row-level security/i,
      );
    }
  });

  test("authenticated approved read and trusted server RPC path still work", () => {
    database.execute(
      `INSERT INTO auth.users(id,email) VALUES('00000000-0000-4000-8000-000000000999','operator@test.invalid') ON CONFLICT DO NOTHING`,
      { tuplesOnly: false },
    );
    assert.equal(database.execute(asAuthenticated("SELECT count(*) FROM public.bags")), "0");
    const trusted = parseJsonOutput(
      database.execute(
        `BEGIN; SET LOCAL ROLE service_role; ${bhsSql({
          bhsUid: "0000000303",
          fingerprint: "FP-SERVER-303",
          eventId: "00000000-0000-4000-8000-000000000303",
        })}; COMMIT`,
      ),
    );
    assert.equal(trusted.status, "ACCEPTED");
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "1");
  });

  test("P2-DB-012 database enforces exact X-ray-to-bag BHS correlation and immutable external identity", () => {
    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone)
       VALUES('ETB-XRAY','0000000401','0123456789','SV1','TEST','IDENTIFIED','TAGGING_STATION')`,
      { tuplesOnly: false },
    );
    database.execute(
      `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status)
       VALUES('ETB-XRAY','0000000401','SCAN-401','TEST','PENDING')`,
      { tuplesOnly: false },
    );
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.throws(
      () =>
        database.execute(
          `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status)
           VALUES('ETB-XRAY','0000000499','SCAN-499','TEST','PENDING')`,
        ),
      /does not match its bag|xray_scans_bag_bhs_uid_correlation/i,
    );
    assert.throws(
      () =>
        database.execute(
          "UPDATE public.xray_scans SET external_scan_id='SCAN-MOVED' WHERE external_scan_id='SCAN-401'",
        ),
      /cannot be reassigned/i,
    );
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
  });

  test("P2-HBSS-019 valid direct scan insert and failure atomicity", () => {
    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone)
       VALUES('ETB-HBSS-DIRECT','0000000501','0123456789','SV1','TEST','IDENTIFIED','TAGGING_STATION')`,
      { tuplesOnly: false },
    );
    database.execute(
      `INSERT INTO public.xray_scans(
         bag_id,bhs_uid,external_scan_id,source_system,status,images,captured_at,metadata
       ) VALUES(
         'ETB-HBSS-DIRECT','0000000501','DIRECT-SCAN-501','TEST_HBSS','AVAILABLE',
         '[{"id":"IMAGE-501","label":"Side view","url":"/mock-xray/test/side.jpg","mimeType":"image/jpeg"}]'::jsonb,
         '2026-08-02T10:00:00.000Z','{"integrationSiteId":"RUH"}'::jsonb
       )`,
      { tuplesOnly: false },
    );
    assert.equal(
      database.execute(
        "SELECT bag_id||':'||bhs_uid||':'||external_scan_id||':'||source_system||':'||status FROM public.xray_scans",
      ),
      "ETB-HBSS-DIRECT:0000000501:DIRECT-SCAN-501:TEST_HBSS:AVAILABLE",
    );

    assert.throws(
      () =>
        database.execute(
          `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
           VALUES('ETB-HBSS-DIRECT','0000000501','DIRECT-SCAN-501','TEST_HBSS','PENDING','[]'::jsonb)`,
        ),
      /duplicate key|idx_xray_scans_source_external/i,
    );
    assert.equal(database.execute("SELECT status FROM public.xray_scans"), "AVAILABLE");

    database.execute(
      `CREATE OR REPLACE FUNCTION public.fail_test_direct_xray_insert()
       RETURNS TRIGGER LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.external_scan_id='DIRECT-SCAN-FAIL' THEN RAISE EXCEPTION 'forced direct X-ray failure'; END IF;
         RETURN NEW;
       END $$;
       CREATE TRIGGER fail_test_direct_xray_insert
       BEFORE INSERT ON public.xray_scans
       FOR EACH ROW EXECUTE FUNCTION public.fail_test_direct_xray_insert()`,
      { tuplesOnly: false },
    );
    try {
      assert.throws(
        () =>
          database.execute(
            `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
             VALUES('ETB-HBSS-DIRECT','0000000501','DIRECT-SCAN-FAIL','TEST_HBSS','AVAILABLE',
             '[{"id":"FAIL","label":"Fail","url":"/mock-xray/test/fail.jpg","mimeType":"image/jpeg"}]'::jsonb)`,
          ),
        /forced direct X-ray failure/i,
      );
      assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    } finally {
      database.execute(
        "DROP TRIGGER IF EXISTS fail_test_direct_xray_insert ON public.xray_scans; DROP FUNCTION IF EXISTS public.fail_test_direct_xray_insert()",
        { tuplesOnly: false },
      );
    }

    database.execute(
      `CREATE OR REPLACE FUNCTION public.fail_test_direct_xray_audit()
       RETURNS TRIGGER LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'forced direct X-ray audit failure'; END $$;
       CREATE TRIGGER fail_test_direct_xray_audit
       BEFORE INSERT ON public.audit_events
       FOR EACH ROW EXECUTE FUNCTION public.fail_test_direct_xray_audit()`,
      { tuplesOnly: false },
    );
    try {
      assert.throws(
        () =>
          database.execute(
            `INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,source_system,outcome)
             VALUES('XRAY_SCAN_RECEIVED','INTEGRATION','TEST_HBSS','ETB-HBSS-DIRECT','TEST_HBSS','SUCCESS')`,
          ),
        /forced direct X-ray audit failure/i,
      );
      // Direct adapter/HTTP ingestion uses the documented best-effort audit
      // policy, so a separately committed scan remains authoritative.
      assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    } finally {
      database.execute(
        "DROP TRIGGER IF EXISTS fail_test_direct_xray_audit ON public.audit_events; DROP FUNCTION IF EXISTS public.fail_test_direct_xray_audit()",
        { tuplesOnly: false },
      );
    }
  });

  test("P2-HBSS-019 exact direct duplicate remains one row after retry and restart", () => {
    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone)
       VALUES('ETB-HBSS-RETRY','0000000502','0123456789','SV1','TEST','IDENTIFIED','TAGGING_STATION')`,
      { tuplesOnly: false },
    );
    const retrySql = `INSERT INTO public.xray_scans(
        bag_id,bhs_uid,external_scan_id,source_system,status,images,metadata
      ) VALUES(
        'ETB-HBSS-RETRY','0000000502','DIRECT-SCAN-502','TEST_HBSS','PENDING','[]'::jsonb,
        '{"integrationSiteId":"RUH"}'::jsonb
      ) ON CONFLICT (source_system,external_scan_id) WHERE external_scan_id IS NOT NULL DO NOTHING`;
    database.execute(retrySql, { tuplesOnly: false });
    database.execute(retrySql, { tuplesOnly: false });
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.equal(
      database.execute("SELECT bag_id||':'||bhs_uid||':'||external_scan_id FROM public.xray_scans"),
      "ETB-HBSS-RETRY:0000000502:DIRECT-SCAN-502",
    );
  });

  test("P2-HBSS-019 concurrent direct duplicate remains one row", async () => {
    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone) VALUES
       ('ETB-HBSS-CONCURRENT-A','0000000503','0123456789','SV1','TEST','IDENTIFIED','TAGGING_STATION'),
       ('ETB-HBSS-CONCURRENT-B','0000000504','0123456789','SV1','TEST','IDENTIFIED','TAGGING_STATION')`,
      { tuplesOnly: false },
    );
    const duplicateSql = `INSERT INTO public.xray_scans(
        bag_id,bhs_uid,external_scan_id,source_system,status,images
      ) VALUES('ETB-HBSS-CONCURRENT-A','0000000503','DIRECT-SCAN-503','TEST_HBSS','PENDING','[]'::jsonb)
      ON CONFLICT (source_system,external_scan_id) WHERE external_scan_id IS NOT NULL DO NOTHING`;
    await Promise.all(
      Array.from({ length: 12 }, () => database.executeAsync(duplicateSql, { tuplesOnly: false })),
    );
    await Promise.all([
      database.executeAsync(
        `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
         VALUES('ETB-HBSS-CONCURRENT-A','0000000503','DIRECT-SCAN-503-A2','TEST_HBSS','NOT_FOUND','[]'::jsonb)`,
        { tuplesOnly: false },
      ),
      database.executeAsync(
        `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
         VALUES('ETB-HBSS-CONCURRENT-B','0000000504','DIRECT-SCAN-504','TEST_HBSS','FAILED','[]'::jsonb)`,
        { tuplesOnly: false },
      ),
    ]);
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "3");
    assert.equal(
      database.execute(
        "SELECT count(*) FROM public.xray_scans scan JOIN public.bags bag ON bag.id=scan.bag_id WHERE bag.bhs_uid<>scan.bhs_uid",
      ),
      "0",
    );
  });

  test("P2-HBSS-019 direct correlation and role protections", () => {
    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,source_system,status,current_zone)
       VALUES('ETB-HBSS-PROTECTED','0000000505','0123456789','SV1','TEST','IDENTIFIED','TAGGING_STATION')`,
      { tuplesOnly: false },
    );
    assert.throws(
      () =>
        database.execute(
          `INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
           VALUES('ETB-HBSS-PROTECTED','0000000599','DIRECT-SCAN-599','TEST_HBSS','PENDING','[]'::jsonb)`,
        ),
      /does not match its bag|xray_scans_bag_bhs_uid_correlation/i,
    );
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "0");

    database.execute(
      `BEGIN; SET LOCAL ROLE service_role;
       INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
       VALUES('ETB-HBSS-PROTECTED','0000000505','DIRECT-SCAN-505','TEST_HBSS','PENDING','[]'::jsonb);
       COMMIT`,
      { tuplesOnly: false },
    );
    assert.throws(
      () =>
        database.execute(
          asAuthenticated(
            "UPDATE public.xray_scans SET bhs_uid='0000000599' WHERE external_scan_id='DIRECT-SCAN-505'",
          ),
        ),
      /permission denied|row-level security/i,
    );
    assert.equal(
      database.execute(
        "SELECT bhs_uid FROM public.xray_scans WHERE external_scan_id='DIRECT-SCAN-505'",
      ),
      "0000000505",
    );
  });
}
