import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPostgresHarness, parseJsonOutput, postgresTestAvailability } from "./postgresHarness.mjs";

const availability = postgresTestAvailability();

if (availability.available) {
  const database = createPostgresHarness(availability.databaseUrl, {
    psqlPath: availability.psqlPath,
  });

  test.before(async () => {
    await database.migrateClean();
  });

  function sql(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
  }

  function payloadHash(values) {
    return createHash("sha256")
      .update(
        [
          values.siteId,
          values.readerId,
          values.sourceEventId,
          values.epc,
          String(values.antennaPort),
          values.rssiDbm === null ? "" : String(values.rssiDbm),
          values.firstSeenAt,
          values.lastSeenAt,
          String(values.readCount),
          values.adapterType,
          values.simulated ? "1" : "0",
        ].join("\u001f"),
      )
      .digest("hex");
  }

  function seedReader() {
    database.execute(`
      INSERT INTO public.readers (
        id, reader_code, site_id, name, zone, adapter_type, enabled, health_status,
        configuration_version, version, created_at, updated_at
      ) VALUES (
        'reader-customs-exit', 'RDR-CUS-TEST', 'ALWAJH', 'Customs Exit Reader', 'CUSTOMS_EXIT',
        'SIMULATED', TRUE, 'SIMULATED', 1, 1, NOW(), NOW()
      )
      ON CONFLICT DO NOTHING
    `);
  }

  function seedDetection({
    sourceEventId,
    epc,
    zone,
    readerId = 'reader-customs-exit',
    readerZone = 'CUSTOMS_EXIT',
    eventId,
  }) {
    seedReader();
    const firstSeenAt = '2026-08-04T10:00:00.000Z';
    const lastSeenAt = '2026-08-04T10:00:00.000Z';
    const receivedAt = '2026-08-04T10:00:01.000Z';
    const hash = payloadHash({
      siteId: 'ALWAJH',
      readerId,
      sourceEventId,
      epc,
      antennaPort: 3,
      rssiDbm: -42,
      firstSeenAt,
      lastSeenAt,
      readCount: 1,
      adapterType: 'SIMULATED',
      simulated: true,
    });
    database.execute(`
      INSERT INTO public.readers (
        id, reader_code, site_id, name, zone, adapter_type, enabled, health_status,
        configuration_version, version, created_at, updated_at
      ) VALUES (
        ${sql(readerId)}, ${sql(`RDR-${sourceEventId}`)}, 'ALWAJH', 'Seed Reader', ${sql(readerZone)},
        'SIMULATED', TRUE, 'SIMULATED', 1, 1, NOW(), NOW()
      )
      ON CONFLICT DO NOTHING;
      INSERT INTO public.rfid_events(
        id, site_id, reader_id, zone, event_type, source_event_id, epc, antenna_port, rssi_dbm,
        first_seen_at, last_seen_at, read_count, adapter_type, simulated,
        received_at, payload_hash, created_at
      ) VALUES (
        ${sql(eventId)}, 'ALWAJH', ${sql(readerId)}, ${sql(zone)}, 'RFID_READ', ${sql(sourceEventId)}, ${sql(epc)}, 3, -42,
        ${sql(firstSeenAt)}::timestamptz, ${sql(lastSeenAt)}::timestamptz, 1, 'SIMULATED', TRUE,
        ${sql(receivedAt)}::timestamptz, ${sql(hash)}, NOW()
      );
    `, { tuplesOnly: false });
    const detection = parseJsonOutput(
      database.execute(`
        SELECT public.process_beltcon_baseline_rfid_detection_v1(${sql(eventId)}::text)
      `),
    );
    return { eventId, detectionId: detection.detectionId };
  }

  function seedAlarmEligibleBag({ bagId, epc, tagId, assignmentId }) {
    database.execute(`
      INSERT INTO public.bags(
        id, bhs_uid, iata_code, epc, flight, is_suspect, status, current_zone, created_at
      ) VALUES (
        ${sql(bagId)}, '0000004101', '0123456789', ${sql(epc)}, 'SV410', TRUE, 'TAGGED', 'TAGGING_STATION', NOW()
      )
      ON CONFLICT DO NOTHING;
      INSERT INTO public.tags(id, epc, rfid_tag_barcode, status, bag_id, site_id, station_id, created_at, updated_at)
      VALUES (
        ${sql(tagId)}, ${sql(epc)}, ${sql(`${bagId}-barcode`)}, 'ASSIGNED', ${sql(bagId)}, 'ALWAJH', 'TAGGING', NOW(), NOW()
      )
      ON CONFLICT DO NOTHING;
      INSERT INTO public.bag_tag_assignments(
        id, bag_id, tag_id, assignment_version, assignment_status, assigned_at, assigned_by,
        site_id, station_id, commit_request_id, commit_payload_hash
      ) VALUES (
        ${sql(assignmentId)}, ${sql(bagId)}, ${sql(tagId)}, 1, 'ACTIVE', NOW(), 'tester',
        'ALWAJH', 'TAGGING', ${sql(`${bagId}-commit`)}, ${sql('a'.repeat(64))}
      )
      ON CONFLICT DO NOTHING;
    `, { tuplesOnly: false });
  }

  function seedUnknownEpcBag() {
    database.execute(`DELETE FROM public.bags WHERE id = 'ETB-UNKNOWN'; DELETE FROM public.tags WHERE bag_id = 'ETB-UNKNOWN'; DELETE FROM public.bag_tag_assignments WHERE bag_id = 'ETB-UNKNOWN';`, { tuplesOnly: false });
  }

  function processDetection(detectionId) {
    return parseJsonOutput(
      database.execute(`SELECT public.process_beltcon_customs_exit_alarm_v1(${sql(detectionId)}::text)`),
    );
  }

  test('Customs Exit alarm RPC opens one alarm for an active suspect bag and stays idempotent', async () => {
    await database.resetOperationalData();

    const { detectionId } = seedDetection({
      sourceEventId: 'exit-001',
      epc: '00AA00AA00AA00AA00AA00AA',
      zone: 'CUSTOMS_EXIT',
      eventId: '11111111-1111-4111-8111-111111111111',
    });
    seedAlarmEligibleBag({
      bagId: 'ETB-EXIT-001',
      epc: '00AA00AA00AA00AA00AA00AA',
      tagId: '33333333-3333-4333-8333-333333333333',
      assignmentId: '44444444-4444-4444-8444-444444444444',
    });

    const first = processDetection(detectionId);
    assert.equal(first.outcome, 'ALARM_CREATED');

    assert.equal(
      database.execute("SELECT count(*) FROM public.alarms WHERE bag_id='ETB-EXIT-001' AND outcome='OPEN' AND severity='HIGH'"),
      '1',
    );
    assert.equal(database.execute("SELECT status FROM public.bags WHERE id='ETB-EXIT-001'"), 'ALARMED');
    assert.equal(
      database.execute("SELECT count(*) FROM public.alarm_actions WHERE alarm_id=(SELECT id FROM public.alarms WHERE bag_id='ETB-EXIT-001' LIMIT 1) AND action='OPENED'"),
      '1',
    );
    assert.equal(
      database.execute("SELECT count(*) FROM public.audit_events WHERE bag_id='ETB-EXIT-001' AND action='CUSTOMS_EXIT_ALARM_OPENED'"),
      '1',
    );

    const second = processDetection(detectionId);
    assert.equal(second.outcome, 'ALARM_ALREADY_ACTIVE');
    assert.equal(
      database.execute("SELECT count(*) FROM public.alarms WHERE bag_id='ETB-EXIT-001' AND outcome IN ('OPEN','ACKNOWLEDGED','UNDER_INVESTIGATION','ESCALATED','SENT_TO_RECHECK')"),
      '1',
    );
  });

  test('Customs Exit alarm RPC ignores TAGGING, RECHECK, and unknown EPC detections', async () => {
    await database.resetOperationalData();

    const tagging = seedDetection({
      sourceEventId: 'tagging-001',
      epc: '00BB00BB00BB00BB00BB00BB',
      zone: 'TAGGING',
      readerZone: 'TAGGING',
      readerId: 'reader-tagging',
      eventId: '55555555-5555-4555-8555-555555555555',
    });
    const recheck = seedDetection({
      sourceEventId: 'recheck-001',
      epc: '00CC00CC00CC00CC00CC00CC',
      zone: 'RECHECK',
      readerZone: 'RECHECK',
      readerId: 'reader-recheck',
      eventId: '66666666-6666-4666-8666-666666666666',
    });
    const unknown = seedDetection({
      sourceEventId: 'unknown-epc-001',
      epc: '00DD00DD00DD00DD00DD00DD',
      zone: 'CUSTOMS_EXIT',
      eventId: '77777777-7777-4777-8777-777777777777',
    });

    const taggingResult = processDetection(tagging.detectionId);
    const recheckResult = processDetection(recheck.detectionId);
    const unknownResult = processDetection(unknown.detectionId);

    assert.equal(taggingResult.outcome, 'NOT_CUSTOMS_EXIT');
    assert.equal(recheckResult.outcome, 'NOT_CUSTOMS_EXIT');
    assert.equal(unknownResult.outcome, 'UNASSIGNED_EPC');

    assert.equal(database.execute('SELECT count(*) FROM public.alarms'), '0');
  });
}
