import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPostgresHarness, parseJsonOutput, postgresTestAvailability } from "./postgresHarness.mjs";

const availability = postgresTestAvailability();

if (availability.available) {
  const database = createPostgresHarness(availability.databaseUrl, { psqlPath: availability.psqlPath });

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

  test("active bag resolution distinguishes active and resolved bags", async () => {
    database.execute(`
      INSERT INTO public.readers (id, reader_code, site_id, name, zone, adapter_type, enabled, health_status, configuration_version, version, created_at, updated_at)
      VALUES ('reader-1', 'RFID-01', 'ALWAJH', 'Reader', 'TAGGING', 'SIMULATED', TRUE, 'SIMULATED', 1, 1, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `);
    database.execute(`
      INSERT INTO public.rfid_read_points (id, site_id, reader_id, antenna_port, code, name, zone, enabled, dedup_window_ms, late_arrival_tolerance_ms, include_antenna_in_key, created_at, updated_at)
      VALUES ('44444444-4444-4444-8444-444444444444', 'ALWAJH', 'reader-1', 1, 'TAGGING:1', 'Tagging', 'TAGGING', TRUE, 1000, 5000, TRUE, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `);
    database.execute(`
      INSERT INTO public.bags (id, source_system, bhs_uid, flight, status, current_zone, epc, rfid_tag_barcode, flagged_at, created_at, updated_at, version)
      VALUES ('ETB-1', 'BHS', '0000000001', 'SV100', 'TAGGED', 'TAGGING', '00AA00AA00AA00AA00AA00AA', 'BAR-1', NOW(), NOW(), NOW(), 1)
    `);
    database.execute(`
      INSERT INTO public.tags (id, epc, rfid_tag_barcode, status, bag_id, site_id, station_id, created_at, updated_at)
      VALUES ('55555555-5555-4555-8555-555555555555', '00AA00AA00AA00AA00AA00AA', 'BAR-1', 'ASSIGNED', 'ETB-1', 'ALWAJH', 'TAGGING', NOW(), NOW())
    `);
    database.execute(`
      INSERT INTO public.bag_tag_assignments (
        id, bag_id, tag_id, assignment_version, assignment_status, assigned_at, assigned_by,
        site_id, station_id, commit_request_id, commit_payload_hash
      )
      VALUES (
        '66666666-6666-4666-8666-666666666666', 'ETB-1', '55555555-5555-4555-8555-555555555555', 1, 'ACTIVE', NOW(), 'tester',
        'ALWAJH', 'TAGGING', 'commit-1', '${"a".repeat(64)}'
      )
    `);
    const raw = parseJsonOutput(
      database.execute(`
        SELECT public.ingest_beltcon_rfid_read_v1(
          'ALWAJH'::text,
          'reader-1'::text,
          'source-1'::text,
          '00AA00AA00AA00AA00AA00AA'::text,
          1::smallint,
          -42::numeric,
          '2026-08-04T10:00:00.000Z'::timestamptz,
          '2026-08-04T10:00:00.000Z'::timestamptz,
          1::integer,
          'SIMULATED'::text,
          TRUE::boolean,
          '2026-08-04T10:00:00.000Z'::timestamptz,
          '${payloadHash({
            siteId: "ALWAJH",
            readerId: "reader-1",
            sourceEventId: "source-1",
            epc: "00AA00AA00AA00AA00AA00AA",
            antennaPort: 1,
            rssiDbm: -42,
            firstSeenAt: "2026-08-04T10:00:00.000Z",
            lastSeenAt: "2026-08-04T10:00:00.000Z",
            readCount: 1,
            adapterType: "SIMULATED",
            simulated: true,
          })}'::text
        )
      `),
    );
    const detection = parseJsonOutput(
      database.execute(
        `SELECT public.process_beltcon_baseline_rfid_detection_v1(${sql(raw.eventId)}::text)`,
      ),
    );

    const active = parseJsonOutput(
      database.execute(
        `SELECT public.resolve_beltcon_active_bag_for_detection_v1(${sql(detection.detectionId)}::text)`,
      ),
    );
    assert.equal(active.outcome, "ACTIVE_SUSPECT_BAG");
    assert.equal(active.alarmEligible, true);

    database.execute(`UPDATE public.bags SET status='RESOLVED', updated_at=NOW() WHERE id='ETB-1'`);
    const resolved = parseJsonOutput(
      database.execute(
        `SELECT public.resolve_beltcon_active_bag_for_detection_v1(${sql(detection.detectionId)}::text)`,
      ),
    );
    assert.equal(resolved.outcome, "BAG_NOT_ALARM_ELIGIBLE");
    assert.equal(resolved.alarmEligible, false);
  });
}
