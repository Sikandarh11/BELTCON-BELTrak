import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/020_create_beltcon_customs_exit_alarm_workflow.sql",
  import.meta.url,
);
const repositoryPath = new URL("../src/services/rfid/rfidReadRepository.server.ts", import.meta.url);
const alarmApiPath = new URL("../src/services/alarms/alarmApi.server.ts", import.meta.url);
const alarmPagePath = new URL("../src/routes/alarms.tsx", import.meta.url);

test("Customs Exit migration creates the durable alarm workflow without deferred integrations", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'HIGH'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.alarm_actions/);
  assert.match(sql, /idx_alarms_active_customs_exit_unique/);
  assert.match(sql, /process_beltcon_rfid_read_v2/);
  assert.match(sql, /CUSTOMS_EXIT_ALARM_OPENED/);
  assert.match(sql, /CUSTOMS_EXIT_ALARM_ALREADY_ACTIVE/);
  assert.match(sql, /acknowledge_beltcon_alarm_v1/);
  assert.match(sql, /escalate_beltcon_alarm_v1/);
  assert.match(sql, /send_beltcon_alarm_to_recheck_v1/);
  assert.match(sql, /VERSION_CONFLICT/);
  assert.match(sql, /SENT_TO_RECHECK/);
  assert.match(sql, /status='UNDER_RECHECK'/);
  assert.doesNotMatch(sql, /create.*xray_scans/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.resolutions/i);
});

test("RFID reads use V2 so an exit result can return a durable alarm outcome", async () => {
  const source = await readFile(repositoryPath, "utf8");
  assert.match(source, /process_beltcon_rfid_read_v2/);
  assert.match(source, /ALARM_CREATED/);
  assert.match(source, /ALARM_ALREADY_ACTIVE/);
  assert.match(source, /BAG_ALREADY_RESOLVED/);
  assert.match(source, /alarm:/);
});

test("Alarm APIs enforce persisted permissions and never accept a client actor", async () => {
  const source = await readFile(alarmApiPath, "utf8");
  assert.match(source, /requirePermission/);
  assert.match(source, /"audit\.view"/);
  assert.match(source, /"alarm\.acknowledge"/);
  assert.match(source, /"alarm\.escalate"/);
  assert.match(source, /"bag\.recheck"/);
  assert.match(source, /actorId: authorization\.session\.user\.id/);
  assert.doesNotMatch(source, /workspaceMode/);
});

test("Alarm page is Query-backed and does not reintroduce browser alarm authority", async () => {
  const source = await readFile(alarmPagePath, "utf8");
  assert.match(source, /useAlarms/);
  assert.match(source, /useAcknowledgeAlarm/);
  assert.match(source, /useEscalateAlarm/);
  assert.match(source, /useSendToRecheck/);
  assert.doesNotMatch(source, /useAppStore/);
  assert.doesNotMatch(source, /alarmService/);
  assert.doesNotMatch(source, /bagService/);
});
