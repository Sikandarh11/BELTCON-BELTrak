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
  test("P3 PostgreSQL tagging workflow gate", { skip: availability.reason }, () => {
    if (process.env.SBTS_REQUIRE_POSTGRES_TESTS === "true") throw new Error(availability.reason);
  });
} else {
  const database = createPostgresHarness(availability.databaseUrl, {
    psqlPath: availability.psqlPath,
  });
  test.before(async () => database.migrateClean());
  test.beforeEach(() => database.resetOperationalData());

  const hash = (character) => character.repeat(64);
  const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const result = (sql) => parseJsonOutput(database.execute(`SELECT (${sql})::text`));
  const operation = (name, args) => result(`public.${name}(${args.join(",")})`);

  function seedReadyBag({
    suffix = 1,
    position = 1,
    state = "ACTIVE",
    mode = "PRE_ENCODED_TAG",
    photo = "REQUIRED",
    inventory = false,
  } = {}) {
    const bagId = `ETB-P3-${suffix}`;
    const bhsUid = String(8000000000 + suffix);
    const queueId = uuid(10000 + suffix);
    operation("configure_tagging_station_v1", [
      "'ALWAJH'",
      "'TAG-01'",
      "ARRAY['01']::text[]",
      `'${mode}'`,
      `'${photo}'`,
      "true",
      "3",
      "ARRAY[96,128]::integer[]",
      "false",
      "false",
      inventory ? "true" : "false",
      "false",
      "1800",
      "1048576",
      "'admin'",
      `'config-${suffix}'`,
    ]);
    database.execute(
      `INSERT INTO public.bags(
        id,bhs_uid,bhs_line_id,screening_evaluation_raw,screening_evaluation,
        bhs_confirmation_status,bhs_confirmed_at,screening_received_at,screened_at,
        screening_station,threat_type,threat_level,source_system,status,current_zone,is_suspect
      ) VALUES(
        '${bagId}','${bhsUid}','01','R','REJECT','CONFIRMED',NOW(),NOW(),NOW(),
        'XRAY-01','UNRESOLVED',3,'P3_TEST','IDENTIFIED','TAGGING_STATION',true
      );
      UPDATE public.bags SET tagging_readiness_status='READY_FOR_TAGGING',tagging_ready_at=NOW() WHERE id='${bagId}';
      INSERT INTO public.screening_integration_events(
        event_id,source_system,event_type,schema_version,payload_hash,processing_status,
        bag_id,processed_at,protocol_name,protocol_version,message_type,message_direction,
        bhs_line_id,screening_evaluation,screening_evaluation_raw,message_fingerprint,
        processing_attempt_count,station_id,site_id,station_synchronized_at
      ) VALUES(
        '${uuid(20000 + suffix)}','P3_STATION','BHS_MESSAGE',1,'${hash("a")}',
        'ACCEPTED','${bagId}',NOW(),'BELTCON_SBTS_SEMANTIC_V1','1',2001,'INBOUND',
        '01','REJECT','R','P3-FP-${suffix}',1,'TAG-01','ALWAJH',NOW()
      )`,
      { tuplesOnly: false },
    );
    const synchronized = operation("sync_tagging_station_queue_item_v1", [
      `'${queueId}'::uuid`,
      "'ALWAJH'",
      "'TAG-01'",
      `'${bhsUid}'`,
      "'01'",
      "'R'",
      String(position),
      `'${state}'`,
      "1",
      "NOW()",
      `'queue-${suffix}'`,
    ]);
    assert.equal(synchronized.status, "SYNCHRONIZED");
    return { bagId, bhsUid, queueId, suffix };
  }

  function createSession(seed, request = `create-${seed.suffix}`) {
    return operation("create_tagging_session_v1", [
      `'${seed.queueId}'::uuid`,
      "'operator-1'",
      "'Operations Officer'",
      `'${request}'`,
      `'${hash("b")}'`,
      "false",
    ]);
  }

  function captureIdentity(
    session,
    {
      barcode = `TAG-${session.id.slice(-6)}`,
      epc = "000000000000000000000001",
      request = `capture-${session.id}`,
      actor = "operator-1",
    } = {},
  ) {
    return operation("capture_tagging_identity_v1", [
      `'${session.id}'::uuid`,
      `'${barcode}'`,
      epc === null ? "NULL" : `'${epc}'`,
      "'SCANNER'",
      "NULL",
      String(session.version),
      `'${actor}'`,
      `'${request}'`,
      `'${hash("c")}'`,
    ]);
  }

  function verify(
    session,
    {
      verificationResult = "VERIFIED",
      observed,
      stable = 3,
      request = `verify-${session.id}`,
      actor = "operator-1",
    } = {},
  ) {
    const observedEpcs = observed ?? Array.from({ length: stable }, () => session.expected_epc);
    return operation("record_tagging_verification_v1", [
      `'${session.id}'::uuid`,
      "'RFID-VERIFY-TEST'",
      sqlJson(observedEpcs),
      String(stable),
      `'${verificationResult}'`,
      verificationResult === "VERIFIED" ? "NULL" : `'RFID_VERIFY_${verificationResult}'`,
      String(session.version),
      `'${actor}'`,
      `'${request}'`,
      `'${hash("d")}'`,
      "false",
    ]);
  }

  function stagePhoto(session, request = `photo-${session.id}`, actor = "operator-1") {
    return operation("stage_tagging_bag_photo_v1", [
      `'${session.id}'::uuid`,
      `'tagging-staging/ALWAJH/TAG-01/${session.id}/${request}.png'`,
      "'image/png'",
      "'image/png'",
      "1",
      "1",
      "68",
      `'${hash("e")}'`,
      "NOW()",
      String(session.version),
      `'${actor}'`,
      `'${request}'`,
      `'${hash("f")}'`,
      actor === "supervisor-1" ? "'Customs Supervisor'" : "'Operations Officer'",
      "NULL",
      "false",
    ]);
  }

  function commit(
    session,
    request = `commit-${session.id}`,
    actor = "operator-1",
    role = "Operations Officer",
  ) {
    return operation("commit_tagging_session_v1", [
      `'${session.id}'::uuid`,
      String(session.version),
      `'${actor}'`,
      `'${role}'`,
      `'${request}'`,
      `'${hash("1")}'`,
    ]);
  }

  function readyForCommit(options = {}) {
    const seed = seedReadyBag(options);
    let session = createSession(seed).session;
    session = captureIdentity(session, { barcode: options.barcode, epc: options.epc }).session;
    session = verify(session).session;
    if ((options.photo ?? "REQUIRED") === "REQUIRED") session = stagePhoto(session).session;
    return { seed, session };
  }

  test("P3-TAG-001 readiness validation rejects a bag that lost readiness", () => {
    const seed = seedReadyBag();
    database.execute(
      `UPDATE public.bags SET tagging_readiness_status='AWAITING_XRAY' WHERE id='${seed.bagId}'`,
      { tuplesOnly: false },
    );
    assert.equal(createSession(seed).status, "BAG_NOT_READY");
  });

  test("P3-TAG-002 active queue item creates a server session bound to BagID", () => {
    const seed = seedReadyBag();
    const created = createSession(seed);
    assert.equal(created.status, "CREATED");
    assert.equal(created.session.bhs_uid, seed.bhsUid);
    assert.equal(created.session.state, "READY_FOR_INPUT");
  });

  test("P3-TAG-003 BASE_ALWAJH allows RFID tagging without X-ray evidence", () => {
    const seed = seedReadyBag({ suffix: 3, mode: "PRINT_AND_ENCODE" });
    assert.equal(
      database.execute(`SELECT count(*) FROM public.xray_scans WHERE bag_id='${seed.bagId}'`),
      "0",
    );
    let session = createSession(seed, "create-no-xray").session;
    session = captureIdentity(session, {
      barcode: "NO-XRAY-TAG",
      epc: null,
      request: "capture-no-xray",
    }).session;
    session = verify(session, { request: "verify-no-xray" }).session;
    session = stagePhoto(session, "photo-no-xray").session;
    const committed = commit(session, "commit-no-xray");

    assert.equal(committed.status, "COMMITTED");
    assert.equal(database.execute("SELECT status FROM public.bags"), "TAGGED");
  });

  test("P3-TAG-003 waiting queue item cannot create a session", () => {
    const seed = seedReadyBag({ position: 2, state: "WAITING" });
    assert.equal(createSession(seed).status, "QUEUE_ITEM_NOT_ACTIVE");
  });

  test("P3-DB-TAG-004 one active session exists per bag and queue item", () => {
    const seed = seedReadyBag();
    assert.equal(createSession(seed).status, "CREATED");
    assert.equal(createSession(seed, "create-second").status, "ACTIVE_SESSION_EXISTS");
    assert.equal(database.execute("SELECT count(*) FROM public.tagging_sessions"), "1");
  });

  test("P3-TAG-021 session creation retry is idempotent and changed payload conflicts", () => {
    const seed = seedReadyBag();
    const first = createSession(seed, "create-retry");
    assert.equal(createSession(seed, "create-retry").status, "DUPLICATE");
    const changed = operation("create_tagging_session_v1", [
      `'${seed.queueId}'::uuid`,
      "'other-operator'",
      "'Operations Officer'",
      "'create-retry'",
      `'${hash("9")}'`,
      "false",
    ]);
    assert.equal(changed.status, "IDEMPOTENCY_CONFLICT");
    assert.equal(first.session.id, createSession(seed, "create-retry").session.id);
  });

  test("P3-TAG-004 pre-encoded capture preserves exact barcode and canonicalizes EPC", () => {
    const session = createSession(seedReadyBag()).session;
    const captured = captureIdentity(session, {
      barcode: "00TagCase",
      epc: "abcdefabcdefabcdefabcdef",
    });
    assert.equal(captured.status, "CAPTURED");
    assert.equal(captured.session.rfid_tag_barcode, "00TagCase");
    assert.equal(captured.session.expected_epc, "ABCDEFABCDEFABCDEFABCDEF");
  });

  test("P3-TAG-005 malformed and unsupported EPC values are rejected", () => {
    const session = createSession(seedReadyBag()).session;
    const invalid = captureIdentity(session, { epc: "NOT-HEX" });
    assert.equal(invalid.status, "INVALID_EPC");
    const unsupported = captureIdentity(session, { epc: "AA".repeat(8), request: "capture-short" });
    assert.equal(unsupported.status, "UNSUPPORTED_EPC_LENGTH");
  });

  test("P3-TAG-006 EPC reservation is unique across print-and-encode sessions", () => {
    const first = createSession(seedReadyBag({ suffix: 1, mode: "PRINT_AND_ENCODE" })).session;
    const second = createSession(
      seedReadyBag({ suffix: 2, position: 2, state: "WAITING", mode: "PRINT_AND_ENCODE" }),
    );
    assert.equal(second.status, "QUEUE_ITEM_NOT_ACTIVE");
    let captured = captureIdentity(first, { barcode: "PRINT-1", epc: null }).session;
    const reserved = operation("reserve_tagging_epc_v1", [
      `'${captured.id}'::uuid`,
      "'ABCDEFABCDEFABCDEFABCDEF'",
      String(captured.version),
      "'operator-1'",
      "'reserve-1'",
      `'${hash("4")}'`,
    ]);
    assert.equal(reserved.status, "RESERVED");
    assert.equal(
      database.execute("SELECT count(*) FROM public.epc_reservations WHERE status='RESERVED'"),
      "1",
    );
  });

  test("P3-TAG-007 print-and-encode succeeds only after trusted job completion", () => {
    const seed = seedReadyBag({ mode: "PRINT_AND_ENCODE" });
    let session = createSession(seed).session;
    session = captureIdentity(session, { barcode: "PRINT-OK", epc: null }).session;
    let response = operation("reserve_tagging_epc_v1", [
      `'${session.id}'::uuid`,
      "'111111111111111111111111'",
      String(session.version),
      "'operator-1'",
      "'reserve-ok'",
      `'${hash("4")}'`,
    ]);
    session = response.session;
    response = operation("start_tagging_encode_v1", [
      `'${session.id}'::uuid`,
      "'ENCODER-01'",
      "NULL",
      String(session.version),
      "'operator-1'",
      "'encode-start'",
      `'${hash("5")}'`,
    ]);
    assert.equal(response.status, "ENCODING");
    const completed = operation("complete_tagging_encode_v1", [
      `'${response.job.id}'::uuid`,
      "'SUCCEEDED'",
      "NULL",
      "'{}'::jsonb",
      String(response.session.version),
      "'operator-1'",
      "'encode-complete'",
      `'${hash("6")}'`,
    ]);
    assert.equal(completed.session.state, "ENCODED");
  });

  test("P3-TAG-008 encode failure leaves no assigned tag", () => {
    const seed = seedReadyBag({ mode: "PRINT_AND_ENCODE" });
    let session = createSession(seed).session;
    session = captureIdentity(session, { barcode: "PRINT-FAIL", epc: null }).session;
    let response = operation("reserve_tagging_epc_v1", [
      `'${session.id}'::uuid`,
      "'222222222222222222222222'",
      String(session.version),
      "'operator-1'",
      "'reserve-fail'",
      `'${hash("4")}'`,
    ]);
    response = operation("start_tagging_encode_v1", [
      `'${response.session.id}'::uuid`,
      "'ENCODER-01'",
      "NULL",
      String(response.session.version),
      "'operator-1'",
      "'encode-fail-start'",
      `'${hash("5")}'`,
    ]);
    const failed = operation("complete_tagging_encode_v1", [
      `'${response.job.id}'::uuid`,
      "'FAILED'",
      "'RFID_ENCODER_UNAVAILABLE'",
      "'{}'::jsonb",
      String(response.session.version),
      "'operator-1'",
      "'encode-fail-complete'",
      `'${hash("6")}'`,
    ]);
    assert.equal(failed.session.state, "FAILED");
    assert.equal(database.execute("SELECT count(*) FROM public.bag_tag_assignments"), "0");
  });

  test("P3-TAG-009 stable matching reads create durable verification evidence", () => {
    let session = createSession(seedReadyBag()).session;
    session = captureIdentity(session).session;
    const verified = verify(session);
    assert.equal(verified.status, "VERIFIED");
    assert.equal(verified.attempt.stable_read_count, 3);
    assert.equal(verified.session.verified_epc, session.expected_epc);
  });

  test("P3-TAG-010 EPC mismatch fails the session and records a failed tag", () => {
    let session = createSession(seedReadyBag()).session;
    session = captureIdentity(session).session;
    const failed = verify(session, {
      verificationResult: "EPC_MISMATCH",
      observed: ["FFFFFFFFFFFFFFFFFFFFFFFF"],
      stable: 1,
    });
    assert.equal(failed.session.state, "FAILED");
    assert.equal(database.execute("SELECT status FROM public.tags"), "FAILED");
  });

  test("P3-TAG-011 multiple-tag result never becomes verified", () => {
    let session = createSession(seedReadyBag()).session;
    session = captureIdentity(session).session;
    const failed = verify(session, {
      verificationResult: "MULTIPLE_TAGS",
      observed: [session.expected_epc, "FFFFFFFFFFFFFFFFFFFFFFFF"],
      stable: 1,
    });
    assert.equal(failed.status, "MULTIPLE_TAGS");
    assert.equal(failed.session.verified_epc, null);
  });

  test("P3-TAG-013 optional IATA LPC preserves leading zeros and may be omitted", () => {
    let session = createSession(seedReadyBag()).session;
    const updated = operation("update_tagging_lpc_v1", [
      `'${session.id}'::uuid`,
      "'0012345678'",
      String(session.version),
      "'operator-1'",
      "'lpc-update'",
      `'${hash("7")}'`,
    ]);
    assert.equal(updated.session.iata_lpc, "0012345678");
    session = updated.session;
    const removed = operation("update_tagging_lpc_v1", [
      `'${session.id}'::uuid`,
      "NULL",
      String(session.version),
      "'operator-1'",
      "'lpc-remove'",
      `'${hash("8")}'`,
    ]);
    assert.equal(removed.session.iata_lpc, null);
  });

  test("P3-TAG-015 required photo policy blocks commit without photo", () => {
    const seed = seedReadyBag();
    let session = createSession(seed).session;
    session = captureIdentity(session).session;
    session = verify(session).session;
    assert.equal(commit(session).status, "PHOTO_REQUIRED");
    assert.equal(database.execute("SELECT status FROM public.bags"), "IDENTIFIED");
  });

  test("P3-TAG-014 photo retake preserves history and one staged current photo", () => {
    const seed = seedReadyBag();
    let session = verify(captureIdentity(createSession(seed).session).session).session;
    session = stagePhoto(session, "photo-first").session;
    const second = stagePhoto(session, "photo-second");
    assert.equal(second.status, "STAGED");
    assert.equal(database.execute("SELECT count(*) FROM public.bag_photos"), "2");
    assert.equal(
      database.execute("SELECT count(*) FROM public.bag_photos WHERE status='STAGED'"),
      "1",
    );
  });

  test("P3-TAG-017 commit atomically assigns bag, tag, history, and central queue", () => {
    const { session } = readyForCommit();
    const committed = commit(session);
    assert.equal(committed.status, "COMMITTED");
    assert.equal(database.execute("SELECT status FROM public.bags"), "TAGGED");
    assert.equal(
      database.execute("SELECT assignment_status FROM public.bag_tag_assignments"),
      "ACTIVE",
    );
    assert.equal(
      database.execute("SELECT state FROM public.tagging_station_queue_items"),
      "TAGGED",
    );
    const photoId = database.execute("SELECT id FROM public.bag_photos WHERE status='STAGED'");
    const finalized = operation("finalize_tagging_photo_v1", [
      `'${committed.session.id}'::uuid`,
      `'${photoId}'::uuid`,
      "'operator-1'",
      "'photo-finalize'",
      `'${hash("5")}'`,
    ]);
    assert.equal(finalized.status, "FINALIZED");
    assert.equal(database.execute("SELECT status FROM public.bag_photos"), "ACTIVE");
    assert.equal(
      database.execute(
        "SELECT successful_tag_assignments||':'||bags_tagged FROM public.tagging_metrics_v1",
      ),
      "1:1",
    );
    const replacement = operation("stage_tagging_bag_photo_v1", [
      `'${committed.session.id}'::uuid`,
      `'tagging-staging/ALWAJH/TAG-01/${committed.session.id}/post-commit.png'`,
      "'image/png'",
      "'image/png'",
      "1",
      "1",
      "68",
      `'${hash("6")}'`,
      "NOW()",
      String(finalized.session.version),
      "'supervisor-2'",
      "'photo-replace'",
      `'${hash("7")}'`,
      "'Customs Supervisor'",
      "'Corrected bag view after operator review'",
      "false",
    ]);
    assert.equal(replacement.status, "STAGED");
    const replacementFinalized = operation("finalize_tagging_photo_v1", [
      `'${committed.session.id}'::uuid`,
      `'${replacement.photo.id}'::uuid`,
      "'supervisor-2'",
      "'photo-replace-finalize'",
      `'${hash("8")}'`,
    ]);
    assert.equal(replacementFinalized.status, "FINALIZED");
    assert.equal(
      database.execute(
        "SELECT string_agg(status,',' ORDER BY captured_at,id) FROM public.bag_photos",
      ),
      "REPLACED,ACTIVE",
    );
  });

  test("P3-TAG-018 duplicate EPC cannot be captured for another bag", () => {
    const first = readyForCommit({ suffix: 1, epc: "333333333333333333333333", barcode: "BAR-1" });
    commit(first.session);
    const secondSeed = seedReadyBag({ suffix: 2 });
    const second = createSession(secondSeed).session;
    assert.equal(
      captureIdentity(second, { epc: "333333333333333333333333", barcode: "BAR-2" }).status,
      "DUPLICATE_EPC",
    );
  });

  test("P3-TAG-019 duplicate exact barcode cannot be captured", () => {
    const first = readyForCommit({
      suffix: 1,
      epc: "444444444444444444444444",
      barcode: "CaseBarcode",
    });
    commit(first.session);
    const second = createSession(seedReadyBag({ suffix: 2 })).session;
    assert.equal(
      captureIdentity(second, { epc: "555555555555555555555555", barcode: "CaseBarcode" }).status,
      "DUPLICATE_BARCODE",
    );
  });

  test("P3-TAG-020 stale concurrent commit loses on version", () => {
    const { session } = readyForCommit();
    const first = commit(session, "commit-winner");
    assert.equal(first.status, "COMMITTED");
    assert.equal(commit(session, "commit-loser").status, "VERSION_CONFLICT");
    assert.equal(database.execute("SELECT count(*) FROM public.bag_tag_assignments"), "1");
  });

  test("P3-TAG-021 commit response-loss retry returns the authoritative assignment", () => {
    const { session } = readyForCommit();
    const first = commit(session, "commit-retry");
    const replay = commit(session, "commit-retry");
    assert.equal(replay.status, "DUPLICATE");
    assert.equal(replay.assignment.id, first.assignment.id);
    assert.equal(database.execute("SELECT count(*) FROM public.bag_tag_assignments"), "1");
  });

  test("P3-TAG-022 failed tags are never active or assignable", () => {
    let session = createSession(seedReadyBag()).session;
    session = captureIdentity(session, {
      epc: "666666666666666666666666",
      barcode: "FAILED-TAG",
    }).session;
    verify(session, { verificationResult: "TIMED_OUT", observed: [], stable: 0 });
    assert.equal(database.execute("SELECT count(*) FROM public.tags WHERE status='ASSIGNED'"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.bag_tag_assignments"), "0");
  });

  test("P3-TAG-023 replacement commit ends old assignment and increments history", () => {
    const first = readyForCommit({ epc: "777777777777777777777777", barcode: "OLD-TAG" });
    const committed = commit(first.session);
    let replacement = operation("request_tag_replacement_v1", [
      `'${committed.assignment.id}'::uuid`,
      "'supervisor-1'",
      "'Customs Supervisor'",
      "'Damaged label replacement'",
      "'replace-start'",
      `'${hash("2")}'`,
      "false",
    ]);
    assert.equal(replacement.status, "REQUESTED");
    replacement = captureIdentity(replacement.session, {
      epc: "888888888888888888888888",
      barcode: "NEW-TAG",
      request: "replace-capture",
      actor: "supervisor-1",
    });
    replacement = verify(replacement.session, { request: "replace-verify", actor: "supervisor-1" });
    replacement = stagePhoto(replacement.session, "replace-photo", "supervisor-1");
    const replacementCommit = commit(
      replacement.session,
      "replace-commit",
      "supervisor-1",
      "Customs Supervisor",
    );
    assert.equal(replacementCommit.status, "COMMITTED", JSON.stringify(replacementCommit));
    assert.equal(replacementCommit.assignment.assignment_version, 2);
    assert.equal(
      database.execute(
        "SELECT string_agg(assignment_status,',' ORDER BY assignment_version) FROM public.bag_tag_assignments",
      ),
      "REPLACED,ACTIVE",
    );
  });

  test("P3-TAG-024 queue advances only inside successful commit", () => {
    const first = seedReadyBag({ suffix: 1 });
    seedReadyBag({ suffix: 2, position: 2, state: "WAITING" });
    let session = createSession(first).session;
    session = stagePhoto(verify(captureIdentity(session).session).session).session;
    assert.equal(
      database.execute(
        "SELECT position||':'||state FROM public.tagging_station_queue_items WHERE id='" +
          first.queueId +
          "'",
      ),
      "1:TAGGING_IN_PROGRESS",
    );
    commit(session);
    assert.equal(
      database.execute(
        "SELECT bhs_uid||':'||position||':'||state FROM public.tagging_station_queue_items WHERE position=1",
      ),
      "8000000002:1:ACTIVE",
    );
  });

  test("P3-TAG-027 RLS and append-only history deny browser mutation", () => {
    const { session } = readyForCommit();
    commit(session);
    assert.throws(
      () =>
        database.execute(
          "BEGIN; SET LOCAL ROLE authenticated; UPDATE public.tagging_sessions SET state='READY_FOR_INPUT'; ROLLBACK",
        ),
      /permission denied|row-level security/i,
    );
    assert.throws(
      () => database.execute("UPDATE public.tagging_session_events SET action='TAMPERED'"),
      /append-only/i,
    );
    assert.throws(
      () => database.execute("UPDATE public.bag_tag_assignments SET assigned_by='tampered'"),
      /immutable/i,
    );
  });

  test("P3-TAG-032 inventory import is configuration-gated and idempotent", () => {
    seedReadyBag({ inventory: true });
    const rows = [{ epc: "999999999999999999999999", barcode: "INV-1" }];
    const imported = operation("import_tag_inventory_v1", [
      "'ALWAJH'",
      "'TAG-01'",
      "'SUPPLIER'",
      "'BATCH-1'",
      sqlJson(rows),
      "'admin'",
      "'inventory-1'",
      `'${hash("3")}'`,
    ]);
    assert.equal(imported.status, "IMPORTED");
    assert.equal(
      operation("import_tag_inventory_v1", [
        "'ALWAJH'",
        "'TAG-01'",
        "'SUPPLIER'",
        "'BATCH-1'",
        sqlJson(rows),
        "'admin'",
        "'inventory-1'",
        `'${hash("3")}'`,
      ]).status,
      "DUPLICATE",
    );
    assert.equal(
      database.execute("SELECT status FROM public.tags WHERE epc='999999999999999999999999'"),
      "AVAILABLE",
    );
  });
}
