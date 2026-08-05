import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createPostgresHarness,
  parseJsonOutput,
  postgresTestAvailability,
} from "./postgresHarness.mjs";

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

  function payloadHash({
    siteId,
    readerId,
    sourceEventId,
    epc,
    antennaPort,
    rssiDbm,
    firstSeenAt,
    lastSeenAt,
    readCount,
    adapterType,
    simulated,
  }) {
    return createHash("sha256")
      .update(
        [
          siteId,
          readerId,
          sourceEventId,
          epc,
          String(antennaPort),
          rssiDbm === null ? "" : String(rssiDbm),
          firstSeenAt,
          lastSeenAt,
          String(readCount),
          adapterType,
          simulated ? "1" : "0",
        ].join("\u001f"),
      )
      .digest("hex");
  }

  async function seedReader() {
    database.execute(`
      INSERT INTO public.readers (
        id, reader_code, site_id, name, zone, adapter_type, enabled, health_status,
        configuration_version, version, created_at, updated_at
      ) VALUES (
        'reader-1', 'RFID-01', 'ALWAJH', 'Simulator Reader', 'TAGGING', 'SIMULATED',
        TRUE, 'SIMULATED', 1, 1, NOW(), NOW()
      )
      ON CONFLICT DO NOTHING
    `);
  }

  async function ingest({ sourceEventId = "source-1", epc = "00AA00AA00AA00AA00AA00AA" } = {}) {
    const firstSeenAt = "2026-08-04T10:00:00.000Z";
    const lastSeenAt = "2026-08-04T10:00:00.000Z";
    const receivedAt = "2026-08-04T10:00:01.000Z";
    const hash = payloadHash({
      siteId: "ALWAJH",
      readerId: "reader-1",
      sourceEventId,
      epc,
      antennaPort: 3,
      rssiDbm: -42,
      firstSeenAt,
      lastSeenAt,
      readCount: 1,
      adapterType: "SIMULATED",
      simulated: true,
    });
    const result = database.execute(`
      SELECT public.ingest_beltcon_rfid_read_v1(
        ${sql("ALWAJH")}::text,
        ${sql("reader-1")}::text,
        ${sql(sourceEventId)}::text,
        ${sql(epc)}::text,
        3::smallint,
        -42::numeric,
        ${sql(firstSeenAt)}::timestamptz,
        ${sql(lastSeenAt)}::timestamptz,
        1::integer,
        ${sql("SIMULATED")}::text,
        TRUE::boolean,
        ${sql(receivedAt)}::timestamptz,
        ${sql(hash)}::text
      )
    `);
    return parseJsonOutput(result);
  }

  test("authoritative RFID ingestion stores, replays, and conflicts by transport identity", async () => {
    await seedReader();

    const first = await ingest();
    const second = await ingest();

    assert.equal(first.outcome, "STORED");
    assert.equal(second.outcome, "DUPLICATE_REPLAY");
    assert.equal(first.eventId, second.eventId);

    assert.throws(
      () =>
        database.execute(`
          SELECT public.ingest_beltcon_rfid_read_v1(
            'ALWAJH'::text,
            'reader-1'::text,
            'source-1'::text,
            '00FF00AA00AA00AA00AA00AA'::text,
            3::smallint,
            -42::numeric,
            '2026-08-04T10:00:00.000Z'::timestamptz,
            '2026-08-04T10:00:00.000Z'::timestamptz,
            1::integer,
            'SIMULATED'::text,
            TRUE::boolean,
            '2026-08-04T10:00:01.000Z'::timestamptz,
            ${sql(
              payloadHash({
                siteId: "ALWAJH",
                readerId: "reader-1",
                sourceEventId: "source-1",
                epc: "00FF00AA00AA00AA00AA00AA",
                antennaPort: 3,
                rssiDbm: -42,
                firstSeenAt: "2026-08-04T10:00:00.000Z",
                lastSeenAt: "2026-08-04T10:00:00.000Z",
                readCount: 1,
                adapterType: "SIMULATED",
                simulated: true,
              }),
            )}::text
          )
        `),
      /RFID_SOURCE_EVENT_CONFLICT/,
    );

    const count = database.execute("SELECT count(*) FROM public.rfid_events");
    assert.equal(count, "1");

    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "0");
    assert.equal(database.execute("SELECT count(*) FROM public.alarms"), "0");
  });

  test("concurrent identical requests converge on one stored row", async () => {
    await database.resetOperationalData();
    await seedReader();

    const payload = `
      SELECT public.ingest_beltcon_rfid_read_v1(
        'ALWAJH'::text,
        'reader-1'::text,
        'source-concurrent'::text,
        '00AA00AA00AA00AA00AA00AA'::text,
        3::smallint,
        -42::numeric,
        '2026-08-04T10:00:00.000Z'::timestamptz,
        '2026-08-04T10:00:00.000Z'::timestamptz,
        1::integer,
        'SIMULATED'::text,
        TRUE::boolean,
        '2026-08-04T10:00:01.000Z'::timestamptz,
        ${sql(
          payloadHash({
            siteId: "ALWAJH",
            readerId: "reader-1",
            sourceEventId: "source-concurrent",
            epc: "00AA00AA00AA00AA00AA00AA",
            antennaPort: 3,
            rssiDbm: -42,
            firstSeenAt: "2026-08-04T10:00:00.000Z",
            lastSeenAt: "2026-08-04T10:00:00.000Z",
            readCount: 1,
            adapterType: "SIMULATED",
            simulated: true,
          }),
        )}::text
      )
    `;

    const [left, right] = await Promise.all([
      database.executeAsync(payload),
      database.executeAsync(payload),
    ]);
    const leftJson = parseJsonOutput(left);
    const rightJson = parseJsonOutput(right);

    assert.ok(
      [leftJson.outcome, rightJson.outcome].includes("STORED") &&
        [leftJson.outcome, rightJson.outcome].includes("DUPLICATE_REPLAY"),
    );
    assert.equal(database.execute("SELECT count(*) FROM public.rfid_events"), "1");
  });

  test("browser writes are blocked and RFID events remain append-only", async () => {
    await database.resetOperationalData();
    await seedReader();
    const stored = await ingest();

    assert.throws(
      () =>
        database.execute(`
          SET ROLE authenticated;
          INSERT INTO public.rfid_events (
            id, site_id, reader_id, source_event_id, epc, antenna_port, rssi_dbm,
            first_seen_at, last_seen_at, read_count, adapter_type, simulated,
            received_at, payload_hash, created_at
          ) VALUES (
            '44444444-4444-4444-8444-444444444444',
            'ALWAJH',
            'reader-1',
            'browser-write',
            '00AA00AA00AA00AA00AA00AA',
            3,
            -42,
            NOW(),
            NOW(),
            1,
            'SIMULATED',
            TRUE,
            NOW(),
            ${sql("a".repeat(64))},
            NOW()
          )
        `),
      /permission|denied|violates row-level security/i,
    );

    assert.throws(
      () =>
        database.execute(`
          SET ROLE service_role;
          UPDATE public.rfid_events
          SET epc = '00BB00BB00BB00BB00BB00BB'
          WHERE id = ${sql(stored.eventId)}
        `),
      /append-only/i,
    );

    assert.throws(
      () =>
        database.execute(`
          SET ROLE service_role;
          DELETE FROM public.rfid_events
          WHERE id = ${sql(stored.eventId)}
        `),
      /append-only/i,
    );
  });
}
