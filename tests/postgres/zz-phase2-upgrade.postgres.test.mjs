import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresHarness, postgresTestAvailability } from "./postgresHarness.mjs";

const availability = postgresTestAvailability();

if (!availability.available) {
  test("P2-DB-025 migration upgrade gate", { skip: availability.reason }, () => {
    if (process.env.SBTS_REQUIRE_POSTGRES_TESTS === "true") throw new Error(availability.reason);
  });
} else {
  const database = createPostgresHarness(availability.databaseUrl, {
    psqlPath: availability.psqlPath,
  });

  test("P3-DB-UPGRADE upgrade through 026 then 027 preserves and backfills legacy identities", async () => {
    database.resetTestSchemas();
    const initial = await database.applyMigrations({ through: 24 });
    assert.equal(initial.length, 24);
    assert.equal(database.execute("SELECT to_regclass('public.tags') IS NULL"), "t");

    database.execute(
      `INSERT INTO public.bags(id,bhs_uid,iata_code,flight,status,current_zone,source_system,epc,rfid_tag_barcode,tagged_at)
       VALUES
       ('ETB-UPGRADE-VALID','0000004101','0123456789','SV410','IDENTIFIED','TAGGING_STATION','LEGACY',NULL,NULL,NULL),
       ('ETB-UPGRADE-TAGGED','0000004102','0123456788','SV410','TAGGED','TAGGING_STATION','LEGACY','EPC-LEGACY-4102','RFID-LEGACY-4102',NOW()),
       ('ETB-UPGRADE-CLOSED','0000004103','0123456787','SV410','RESOLVED','CUSTOMS_EXIT','LEGACY',NULL,NULL,NULL);
       INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images)
       VALUES('ETB-UPGRADE-VALID','0000004101','LEGACY-SCAN-4101','LEGACY_HBSS','AVAILABLE','[{"id":"legacy","label":"Legacy","url":"/mock-xray/legacy.jpg","mimeType":"image/jpeg"}]'::jsonb);
       INSERT INTO public.audit_events(action,actor_type,bag_id,outcome,metadata)
       VALUES('LEGACY_AUDIT','SYSTEM','ETB-UPGRADE-VALID','SUCCESS','{}'::jsonb);`,
      { tuplesOnly: false },
    );

    const upgraded = await database.applyMigrations({ from: 25, through: 26 });
    assert.deepEqual(upgraded, [
      "025_bhs_hbss_integrity_hardening.sql",
      "026_station_delivery_metadata.sql",
    ]);
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "3");
    assert.equal(database.execute("SELECT count(*) FROM public.xray_scans"), "1");
    assert.equal(
      database.execute("SELECT count(*) FROM public.audit_events WHERE action='LEGACY_AUDIT'"),
      "1",
    );
    assert.equal(
      database.execute(
        "SELECT bag_id||':'||epc||':'||rfid_tag_barcode FROM public.tags WHERE bag_id='ETB-UPGRADE-TAGGED'",
      ),
      "ETB-UPGRADE-TAGGED:EPC-LEGACY-4102:RFID-LEGACY-4102",
    );
    assert.equal(
      database.execute(
        "SELECT bag_id||':'||bhs_uid FROM public.xray_scans WHERE external_scan_id='LEGACY-SCAN-4101'",
      ),
      "ETB-UPGRADE-VALID:0000004101",
    );
    assert.equal(
      database.execute(
        "SELECT convalidated FROM pg_constraint WHERE conname='bags_beltcon_sbts_bhs_uid_format'",
      ),
      "f",
    );
    assert.equal(
      database.execute("SELECT policy FROM public.tagging_readiness_configuration WHERE singleton"),
      "BASE_ALWAJH",
    );
    assert.equal(
      database.execute(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='screening_integration_events' AND column_name IN ('station_id','site_id','station_synchronized_at')",
      ),
      "3",
    );
    assert.throws(
      () =>
        database.execute(
          "UPDATE public.xray_scans SET bhs_uid='0000004999' WHERE external_scan_id='LEGACY-SCAN-4101'",
        ),
      /cannot be reassigned|does not match/i,
    );
    assert.equal(
      database.execute(
        "SELECT bag_id||':'||bhs_uid FROM public.xray_scans WHERE external_scan_id='LEGACY-SCAN-4101'",
      ),
      "ETB-UPGRADE-VALID:0000004101",
    );
    const phase3 = await database.applyMigrations({ from: 27, through: 27 });
    assert.deepEqual(phase3, ["027_complete_tagging_station_workflow.sql"]);
    assert.equal(database.execute("SELECT count(*) FROM public.bags"), "3");
    assert.equal(database.execute("SELECT count(*) FROM public.tags"), "1");
    assert.equal(database.execute("SELECT count(*) FROM public.bag_tag_assignments"), "1");
    assert.equal(
      database.execute(
        "SELECT bag_id||':'||assignment_version||':'||assignment_status FROM public.bag_tag_assignments",
      ),
      "ETB-UPGRADE-TAGGED:1:ACTIVE",
    );
    assert.equal(
      database.execute("SELECT count(*) FROM public.audit_events WHERE action='LEGACY_AUDIT'"),
      "1",
    );
  });
}
