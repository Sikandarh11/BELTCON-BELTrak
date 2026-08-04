import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

const expectedMigrations = [
  "001_create_profiles_table.sql",
  "002_fix_admin_policy.sql",
  "003_create_core_tables.sql",
  "004_seed_readers.sql",
  "005_enable_realtime.sql",
  "006_create_xray_scans.sql",
  "007_create_screening_ingestion.sql",
  "008_create_screening_ingestion_rpc.sql",
  "009_create_authoritative_tagging.sql",
  "010_create_xray_view_audit_guard.sql",
  "011_create_admin_user_profile_repair.sql",
  "012_extend_profiles_for_user_creation.sql",
  "013_create_password_change_completion.sql",
  "014_create_admin_user_lifecycle.sql",
  "015_create_role_permissions.sql",
  "016_beltcon_sbts_baseline_identity_and_messages.sql",
  "017_create_beltcon_bhs_message_ingestion.sql",
  "018_create_beltcon_rfid_tag_assignment.sql",
  "019_create_beltcon_rfid_ingestion_and_antenna_mapping.sql",
  "020_create_beltcon_customs_exit_alarm_workflow.sql",
  "021_create_beltcon_recheck_hbss_resolution_workflow.sql",
  "022_create_beltcon_reader_report_audit_read_models.sql",
  "023_create_beltcon_security_hardening.sql",
  "024_beltcon_hbss_bhs_correlation_and_tagging_readiness.sql",
  "025_bhs_hbss_integrity_hardening.sql",
  "026_station_delivery_metadata.sql",
  "027_complete_tagging_station_workflow.sql",
];

test("the migration chain is complete and ordered from 001 through 027", async () => {
  const actual = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(actual, expectedMigrations);
});

test("Baseline V1 mutation migrations revoke public execution and use service-role RPCs", async () => {
  const mutationMigrations = expectedMigrations.slice(16);
  const content = await Promise.all(
    mutationMigrations.map((name) =>
      readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
    ),
  );
  const sql = content.join("\n");

  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]+?FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]+?TO service_role/i);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION[^;]*TO\s+(?:PUBLIC|anon|authenticated)\b/i);
});
