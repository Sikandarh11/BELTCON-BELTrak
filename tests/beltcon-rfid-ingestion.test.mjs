import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("migration 019 adds immutable BELTCON RFID events and antenna authority", async () => {
  const sql = await read(
    "supabase/migrations/019_create_beltcon_rfid_ingestion_and_antenna_mapping.sql",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.reader_antennas/);
  assert.match(sql, /UNIQUE \(reader_id, port_number\)/);
  assert.match(sql, /port_number BETWEEN 1 AND 64/);
  assert.match(sql, /idx_rfid_events_source_event_unique/);
  assert.match(sql, /process_beltcon_rfid_read_v1/);
  assert.match(sql, /UNASSIGNED_EPC/);
  assert.match(sql, /EXIT_DETECTED/);
  assert.match(sql, /FOR UPDATE/);
  assert.doesNotMatch(sql, /INSERT INTO public\.(?:alarms|xray_scans)/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
});

test("RFID APIs are server-authenticated and simulator supplies no zone", async () => {
  const [integration, simulator, ui] = await Promise.all([
    read("src/services/rfid/rfidReadApi.server.ts"),
    read("src/services/rfid/rfidSimulatorApi.server.ts"),
    read("src/features/simulator/SimulatorPanel.tsx"),
  ]);
  assert.match(integration, /x-rfid-integration-key/);
  assert.match(integration, /timingSafeEqual/);
  assert.doesNotMatch(integration, /useAppStore|RFID_INTEGRATION_KEY.*client/i);
  assert.match(simulator, /BELTCON_RFID_SIMULATOR/);
  assert.match(simulator, /developer\.access/);
  assert.match(ui, /useRfidTrackableBags/);
  assert.match(ui, /useReaderAntennaMap/);
  assert.match(ui, /useSubmitSimulatedRfidRead/);
  assert.doesNotMatch(ui, /useAppStore|eventService|alarmService|bagService/);
  assert.doesNotMatch(ui, /zone:\s*values\./);
});

test("RFID schema and server result keep location authority on reader antenna mapping", async () => {
  const [schema, client] = await Promise.all([
    read("src/services/rfid/rfidReadSchemas.ts"),
    read("src/services/rfid/rfidClient.ts"),
  ]);
  assert.match(schema, /sourceEventId/);
  assert.match(schema, /antennaPort/);
  assert.match(schema, /rssiDbm/);
  assert.doesNotMatch(schema, /\bzone:\s*z\./);
  assert.match(client, /\/api\/readers\/antenna-map/);
  assert.match(client, /\/api\/dev\/simulator\/rfid\/reads/);
});
