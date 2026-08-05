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
      .update([values.siteId, values.readerId, values.sourceEventId, values.epc, String(values.antennaPort), values.rssiDbm === null ? "" : String(values.rssiDbm), values.firstSeenAt, values.lastSeenAt, String(values.readCount), values.adapterType, values.simulated ? "1" : "0"].join("\u001f"))
      .digest("hex");
  }

  async function seedReader(readerId = "reader-1", zone = "TAGGING") {
    database.execute(`
      INSERT INTO public.readers (id, reader_code, site_id, name, zone, adapter_type, enabled, health_status, configuration_version, version, created_at, updated_at)
      VALUES (${sql(readerId)}, ${sql(`RFID-${readerId}`)}, 'ALWAJH', 'Reader', ${sql(zone)}, 'SIMULATED', TRUE, 'SIMULATED', 1, 1, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `);
  }

  async function ingest({ sourceEventId, epc, firstSeenAt, lastSeenAt, rssiDbm = -42, readCount = 1, readerId = "reader-1" }) {
    const siteId = "ALWAJH";
    const payload = {
      siteId,
      readerId,
      sourceEventId,
      epc,
      antennaPort: 1,
      rssiDbm,
      firstSeenAt,
      lastSeenAt,
      readCount,
      adapterType: "SIMULATED",
      simulated: true,
    };
    const result = database.execute(`
      SELECT public.ingest_beltcon_rfid_read_v1(${sql(siteId)}::text, ${sql(readerId)}::text, ${sql(sourceEventId)}::text, ${sql(epc)}::text, 1::smallint, ${rssiDbm}::numeric, ${sql(firstSeenAt)}::timestamptz, ${sql(lastSeenAt)}::timestamptz, ${readCount}::integer, 'SIMULATED'::text, TRUE::boolean, ${sql(lastSeenAt)}::timestamptz, ${sql(payloadHash(payload))}::text)
    `);
    return parseJsonOutput(result);
  }

  async function detect(eventId) {
    const result = database.execute(`SELECT public.process_beltcon_baseline_rfid_detection_v1(${sql(eventId)}::text)`);
    return parseJsonOutput(result);
  }

  test("baseline detection creates, updates, replays, and ignores optional zones", async () => {
    await seedReader("reader-1", "TAGGING");
    const first = await ingest({ sourceEventId: "s1", epc: "00AA00AA00AA00AA00AA00AA", firstSeenAt: "2026-08-04T10:00:00.000Z", lastSeenAt: "2026-08-04T10:00:00.000Z" });
    const created = await detect(first.eventId);
    assert.equal(created.outcome, "DETECTION_CREATED");
    const replay = await detect(first.eventId);
    assert.equal(replay.outcome, "DETECTION_CREATED");
    assert.equal(database.execute("SELECT count(*) FROM public.rfid_events"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.rfid_detections"), "1");

    await seedReader("reader-2", "WASHROOM");
    const optional = await ingest({ sourceEventId: "s2", epc: "00BB00BB00BB00BB00BB00BB", firstSeenAt: "2026-08-04T10:00:00.000Z", lastSeenAt: "2026-08-04T10:00:00.000Z", readerId: "reader-2" });
    const ignored = await detect(optional.eventId);
    assert.equal(ignored.outcome, "OPTIONAL_ZONE_IGNORED");
  });
}
