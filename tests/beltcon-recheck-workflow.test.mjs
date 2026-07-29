import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../supabase/migrations/021_create_beltcon_recheck_hbss_resolution_workflow.sql",
  import.meta.url,
);
const recheckPage = new URL("../src/routes/recheck.tsx", import.meta.url);
const service = new URL("../src/services/recheck/recheckService.server.ts", import.meta.url);
const api = new URL("../src/services/recheck/recheckApi.server.ts", import.meta.url);

test("Phase 7 migration persists recall attempts and atomically resolves bag and alarm", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.hbss_recall_requests/);
  assert.match(sql, /idx_hbss_recall_actor_bag_idempotency/);
  assert.match(sql, /resolve_beltcon_recheck_case_v1/);
  assert.match(sql, /status='RESOLVED'/);
  assert.match(sql, /outcome='CLOSED'/);
  assert.match(sql, /RECHECK_INSPECTION_RESOLVED/);
  assert.match(sql, /ALARM_CLOSED/);
  assert.match(sql, /HBSS_RECALL_SIMULATED/);
});

test("Recheck uses the existing safe HBSS adapter boundary", async () => {
  const source = await readFile(service, "utf8");
  assert.match(source, /SimulatedHbssRecallAdapter/);
  assert.match(source, /Rs232HbssRecallAdapter/);
  assert.match(source, /HBSS_RECALL_ADAPTER/);
  assert.doesNotMatch(source, /serialport|COM\d|\/dev\//i);
});

test("Recheck UI is server-backed and does not use Zustand or browser lifecycle services", async () => {
  const source = await readFile(recheckPage, "utf8");
  assert.match(source, /useReducer/);
  assert.match(source, /useRecheckQueue/);
  assert.match(source, /useHbssRecall/);
  assert.match(source, /useResolveRecheckCase/);
  assert.doesNotMatch(source, /useAppStore|bagService|alarmService|persistenceService/);
});

test("final Recheck resolution requires the dedicated persisted bag.resolve permission", async () => {
  const [apiSource, pageSource] = await Promise.all([
    readFile(api, "utf8"),
    readFile(recheckPage, "utf8"),
  ]);
  assert.match(apiSource, /authorize\(request, options, "bag\.resolve"\)/);
  assert.match(apiSource, /Permission \$\{permission\} is required/);
  assert.match(pageSource, /hasPermission\(user\.permissions, "bag\.resolve"\)/);
});
