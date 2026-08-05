import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/033_create_beltcon_customs_exit_alarm.sql",
  import.meta.url,
);
const resolutionMigrationPath = new URL(
  "../supabase/migrations/032_create_beltcon_rfid_active_bag_resolution.sql",
  import.meta.url,
);
const detectionServicePath = new URL(
  "../src/services/rfid/detections/rfidDetectionService.server.ts",
  import.meta.url,
);
const customsExitAlarmRepositoryPath = new URL(
  "../src/services/alarms/customsExitAlarmRepository.server.ts",
  import.meta.url,
);
const alarmApiPath = new URL("../src/services/alarms/alarmApi.server.ts", import.meta.url);
const alarmPagePath = new URL("../src/routes/alarms.tsx", import.meta.url);
const rfidIntegrationApiPath = new URL("../src/services/rfid/rfidReadApi.server.ts", import.meta.url);

test("Customs Exit migration creates the durable alarm workflow without deferred integrations", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.process_beltcon_customs_exit_alarm_v1/);
  assert.match(sql, /process_beltcon_customs_exit_alarm_v1\(TEXT\)/);
  assert.match(sql, /NOT_CUSTOMS_EXIT/);
  assert.match(sql, /ALARM_ALREADY_ACTIVE/);
  assert.match(sql, /ALARM_CREATED/);
  assert.match(sql, /status = 'ALARMED'/);
  assert.match(sql, /'status', 'OPEN'/);
  assert.match(sql, /'severity', 'HIGH'/);
  assert.match(sql, /action,.*OPENED/s);
  assert.match(sql, /CUSTOMS_EXIT_ALARM_OPENED/);
  assert.match(sql, /alarm_actions/);
  assert.match(sql, /audit_events/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.process_beltcon_customs_exit_alarm_v1\(TEXT\) TO service_role/);
  assert.doesNotMatch(sql, /create.*xray_scans/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.resolutions/i);
});

test("Resolution migration keeps the authoritative bag resolution outcomes used by the alarm phase", async () => {
  const sql = await readFile(resolutionMigrationPath, "utf8");
  assert.match(sql, /UNASSIGNED_EPC/);
  assert.match(sql, /TAG_NOT_ACTIVE/);
  assert.match(sql, /BAG_NOT_ALARM_ELIGIBLE/);
  assert.match(sql, /ACTIVE_SUSPECT_BAG/);
});

test("RFID detection and alarm services only accept authoritative detection ids", async () => {
  const [detectionService, customsExitAlarmRepository, rfidIntegrationApi] = await Promise.all([
    readFile(detectionServicePath, "utf8"),
    readFile(customsExitAlarmRepositoryPath, "utf8"),
    readFile(rfidIntegrationApiPath, "utf8"),
  ]);
  assert.match(detectionService, /processStoredRfidEvent\(input\)/);
  assert.match(detectionService, /resolveActiveBagForDetection\(parsed\.detectionId\)/);
  assert.match(detectionService, /processForDetection\(parsed\.detectionId\)/);
  assert.match(customsExitAlarmRepository, /rpc\("process_beltcon_customs_exit_alarm_v1"/);
  assert.match(customsExitAlarmRepository, /p_detection_id: detectionId/);
  assert.doesNotMatch(customsExitAlarmRepository, /p_bag_id|p_zone|p_reader_id|p_epc/i);
  assert.match(rfidIntegrationApi, /rfidReadSchema\.safeParse\(payload\)/);
  assert.doesNotMatch(rfidIntegrationApi, /bagId|zone|alarmId/i);
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
