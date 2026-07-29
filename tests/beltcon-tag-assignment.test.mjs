import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("BELTCON assignment migration is additive, versioned, and audited", async () => {
  const migration = await read("supabase/migrations/018_create_beltcon_rfid_tag_assignment.sql");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.assign_beltcon_rfid_tag_v1/);
  assert.match(migration, /p_rfid_tag_barcode TEXT/);
  assert.match(migration, /p_expected_version INTEGER/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /RFID_TAG_ASSIGNED/);
  assert.match(migration, /status = 'TAGGED'/);
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.doesNotMatch(migration, /INSERT INTO public\.(?:alarms|xray_scans)/i);
});

test("new server routes share authoritative service paths without browser credentials", async () => {
  const [simulator, assignRoute, client] = await Promise.all([
    read("src/services/bhs/bhsSimulatorApi.server.ts"),
    read("src/routes/api.bags.$bagId.assign-tag.ts"),
    read("src/services/bags/taggingClient.ts"),
  ]);
  assert.match(simulator, /sourceSystem: SOURCE_SYSTEM/);
  assert.match(simulator, /requirePermission\)\(session, "developer\.access"\)/);
  assert.doesNotMatch(simulator, /BHS_INTEGRATION_KEY/);
  assert.match(assignRoute, /handleAssignRfidTagRequest/);
  assert.match(client, /useTaggingQueue/);
  assert.match(client, /useAssignRfidTag/);
});

test("Tagging UI uses the authoritative queue and has no Zustand fallback", async () => {
  const source = await read("src/routes/tagging.tsx");
  assert.match(source, /useTaggingQueue\(\)/);
  assert.match(source, /useAssignRfidTag\(\)/);
  assert.match(source, /useForm/);
  assert.doesNotMatch(source, /useAppStore/);
  assert.match(source, /Assign RFID Tag/);
});
