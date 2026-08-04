import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import { createProjectModuleLoader, repositoryRoot } from "../helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
after(() => loader.close());
const mappings = await loader.load("/src/services/bagPersistenceMappings.ts");

const migration = async (name) =>
  readFile(path.join(repositoryRoot, "supabase", "migrations", name), "utf8");

const [coreSql, taggingSql, rfidSql, alarmSql, recheckSql] = await Promise.all([
  migration("003_create_core_tables.sql"),
  migration("024_beltcon_hbss_bhs_correlation_and_tagging_readiness.sql"),
  migration("019_create_beltcon_rfid_ingestion_and_antenna_mapping.sql"),
  migration("020_create_beltcon_customs_exit_alarm_workflow.sql"),
  migration("021_create_beltcon_recheck_hbss_resolution_workflow.sql"),
]);

test("the real database bag-status constraint is frozen and differs from the requested lifecycle", () => {
  const bagDefinition = coreSql.slice(
    coreSql.indexOf("create table if not exists public.bags"),
    coreSql.indexOf("-- ALARMS"),
  );
  const realStatuses = [
    "IDENTIFIED",
    "TAGGED",
    "IN_ARRIVAL_HALL",
    "AT_EXIT",
    "ALARMED",
    "UNDER_RECHECK",
    "RESOLVED",
    "MISSING",
    "ESCAPE_ALERT",
    "ESCALATED",
  ];
  for (const status of realStatuses) assert.match(bagDefinition, new RegExp(`'${status}'`));
  for (const absent of [
    "SUSPECT",
    "DIVERTED",
    "IN_HALL",
    "RECHECK",
    "CLEARED",
    "CONFISCATED",
    "CLOSED",
  ]) {
    assert.doesNotMatch(bagDefinition, new RegExp(`'${absent}'`));
  }
});

test("the TypeScript mapper collapses stored states and is not a lossless state machine", () => {
  assert.equal(mappings.rowStatusToBag("IDENTIFIED"), "IDENTIFIED");
  assert.equal(mappings.rowStatusToBag("IN_ARRIVAL_HALL"), "IN_TRANSIT");
  assert.equal(mappings.rowStatusToBag("AT_EXIT"), "IN_TRANSIT");
  assert.equal(mappings.rowStatusToBag("UNDER_RECHECK"), "AT_RECHECK");
  assert.equal(mappings.rowStatusToBag("ESCAPE_ALERT"), "ALARMED");
  assert.equal(mappings.rowStatusToBag("ESCALATED"), "ALARMED");
  assert.equal(mappings.rowStatusToBag("UNKNOWN_STATUS"), "IDENTIFIED");
});

test("current IDENTIFIED to TAGGED mutation is versioned and audits both statuses", () => {
  assert.match(taggingSql, /status='TAGGED',tagged_at=v_now,version=version\+1,updated_at=v_now/);
  assert.match(taggingSql, /'previousStatus','IDENTIFIED','newStatus','TAGGED'/);
  assert.match(taggingSql, /WHERE id=v_bag_id AND version=p_expected_version/);
});

test("current TAGGED to IN_ARRIVAL_HALL mutation is reader-driven and audited", () => {
  assert.match(rfidSql, /zone_code = 'RECLAIM' AND v_bag\.status = 'TAGGED'/);
  assert.match(rfidSql, /status = 'IN_ARRIVAL_HALL', version = version \+ 1, updated_at = v_now/);
  assert.match(rfidSql, /'previousStatus',v_previous_status,'currentStatus',v_current_status/);
});

test("current customs-exit alarm jumps directly to ALARMED and creates durable audit data", () => {
  assert.match(alarmSql, /v_bag\.status NOT IN \('TAGGED','IN_ARRIVAL_HALL'\)/);
  assert.match(
    alarmSql,
    /status = 'ALARMED', current_zone = 'CUSTOMS_EXIT', version = version \+ 1, updated_at = v_now/,
  );
  assert.match(alarmSql, /'CUSTOMS_EXIT_ALARM_OPENED'/);
  assert.match(alarmSql, /'alarmId',v_alarm\.id,'eventId',v_event_id,'zone','CUSTOMS_EXIT'/);
});

test("current ALARMED to UNDER_RECHECK mutation is guarded, versioned, and audited", () => {
  assert.match(alarmSql, /v_bag\.status NOT IN \('ALARMED','IN_ARRIVAL_HALL'\)/);
  assert.match(alarmSql, /status='UNDER_RECHECK'.*version=version\+1,updated_at=v_now/s);
  assert.match(alarmSql, /'BAG_SENT_TO_RECHECK'/);
});

test("current UNDER_RECHECK to RESOLVED mutation records disposition and status history", () => {
  assert.match(recheckSql, /IF v_bag\.status <> 'UNDER_RECHECK'/);
  assert.match(recheckSql, /p_disposition NOT IN \('CLEARED','NOT_CLEARED'\)/);
  assert.match(recheckSql, /status='RESOLVED',version=version\+1,updated_at=v_now/);
  assert.match(recheckSql, /'previousBagStatus','UNDER_RECHECK','newBagStatus','RESOLVED'/);
  assert.match(recheckSql, /'RECHECK_INSPECTION_RESOLVED'/);
});

const requiredValidTransitions = [
  ["SUSPECT", "DIVERTED"],
  ["DIVERTED", "TAGGED"],
  ["TAGGED", "IN_HALL"],
  ["IN_HALL", "AT_EXIT"],
  ["AT_EXIT", "ALARMED"],
  ["ALARMED", "RECHECK"],
  ["RECHECK", "CLEARED"],
  ["RECHECK", "CONFISCATED"],
  ["RECHECK", "ESCALATED"],
  ["CLEARED", "CLOSED"],
  ["CONFISCATED", "CLOSED"],
  ["ESCALATED", "CLOSED"],
  ["IN_HALL", "ESCAPE_ALERT"],
];

for (const [from, to] of requiredValidTransitions) {
  test(
    `${from} -> ${to} updates status, time, event, audit, and no unrelated fields`,
    {
      todo: "No production state-machine service implements this required transition vocabulary",
    },
    () => {},
  );
}

const requiredInvalidTransitions = [
  ["SUSPECT", "CLOSED"],
  ["SUSPECT", "ALARMED"],
  ["TAGGED", "CLEARED"],
  ["IN_HALL", "CLOSED"],
  ["CLOSED", "ALARMED"],
  ["CLOSED", "TAGGED"],
  ["CLEARED", "TAGGED"],
  ["CONFISCATED", "IN_HALL"],
];

for (const [from, to] of requiredInvalidTransitions) {
  test(
    `${from} -> ${to} rejects without event or false success audit`,
    {
      todo: "No production state-machine API exposes a transition operation to test",
    },
    () => {},
  );
}

for (const scenario of [
  "same-state transition has an explicit idempotency rule",
  "closed bags reject normal operational modification",
  "only supervisor or administrator can reopen a closed case",
  "audit records previous and new status for every transition",
  "concurrent lifecycle updates cannot silently overwrite",
  "unknown bag status fails schema validation rather than mapping to IDENTIFIED",
]) {
  test(
    scenario,
    {
      todo: "Required centralized lifecycle rule or schema is absent from production",
    },
    () => {},
  );
}
