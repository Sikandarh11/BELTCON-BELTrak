import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFile(path.join(repositoryRoot, file), "utf8");
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(repositoryRoot, "src") } },
});
test.after(async () => vite.close());

const schemas = await vite.ssrLoadModule(
  "/src/services/integrations/screening/screeningSchemas.ts",
);

const validSuspect = {
  eventId: "00000000-0000-4000-8000-000000002401",
  bhsUid: "0000000034",
  iataCode: "0123456789",
  iataOrigin: "RUH",
  flightNo: "SV241",
  passengerName: "Correlation Test",
  threatType: "Suspect Bag",
  threatLevel: 3,
  screeningEvaluationRaw: "R",
  screeningStation: "HBSS-SIM-01",
  screeningTimestamp: "2026-07-29T10:00:00.000Z",
  externalScanId: "SCAN-2401",
  scanStatus: "PENDING",
  imageSetId: null,
  images: [],
};

test("HBSS simulator preserves a leading-zero 10-character BHS BagID and rejects ACCEPT", () => {
  assert.equal(schemas.screeningSimulatorInputSchema.safeParse(validSuspect).success, true);
  assert.equal(
    schemas.screeningSimulatorInputSchema.safeParse({ ...validSuspect, bhsUid: "34" }).success,
    false,
  );
  assert.equal(
    schemas.screeningSimulatorInputSchema.safeParse({
      ...validSuspect,
      screeningEvaluationRaw: "A",
    }).success,
    false,
  );
});

test("correlation migration establishes two-stage readiness and server-side tag gate", async () => {
  const migration = await read(
    "supabase/migrations/024_beltcon_hbss_bhs_correlation_and_tagging_readiness.sql",
  );
  for (const field of [
    "screening_received_at",
    "bhs_confirmation_status",
    "bhs_confirmed_at",
    "tagging_ready_at",
    "bhs_confirmation_event_id",
  ])
    assert.match(migration, new RegExp(field));
  assert.match(migration, /AWAITING_BHS_CONFIRMATION/);
  assert.match(migration, /CONFIRMED/);
  assert.match(migration, /ingest_screening_suspect_event_v2/);
  assert.match(migration, /ingest_beltcon_bhs_message_v2/);
  assert.match(migration, /beltcon:canonical-bhs:/);
  assert.match(migration, /TAG_ASSIGNMENT_BHS_CONFIRMATION_REQUIRED/);
  assert.match(migration, /BHS diversion confirmation is required before assigning an RFID tag/);
  assert.match(migration, /WHERE bhs_uid = v_bhs_uid/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX[^;]*ON public\.bags\s*\(bhs_uid\)\s*;/i);
});

test("new queue model returns one canonical readiness record and keeps the tag form disabled", async () => {
  const [repository, route, type] = await Promise.all([
    read("src/services/bags/taggingRepository.server.ts"),
    read("src/routes/tagging.tsx"),
    read("src/types/tagging.ts"),
  ]);
  assert.match(repository, /canonicalQueueRows/);
  assert.match(repository, /bhs_confirmation_status === "CONFIRMED"/);
  assert.match(repository, /canAssignTag:/);
  assert.match(type, /AWAITING_BHS_CONFIRMATION/);
  assert.match(type, /READY_FOR_TAGGING/);
  assert.match(route, /tagAssignmentDisabled/);
  assert.match(
    route,
    /RFID assignment will be enabled after BHS message 2001 confirms the diversion/,
  );
  assert.doesNotMatch(route, /Legacy suspect/);
});

test("normal BHS simulator confirms a server-loaded pending case without browser identity authority", async () => {
  const [component, api, pendingRoute, confirmRoute] = await Promise.all([
    read("src/features/simulator/BeltconBhsSimulator.tsx"),
    read("src/services/bhs/bhsSimulatorApi.server.ts"),
    read("src/routes/api.dev.simulator.bhs.pending-confirmations.ts"),
    read("src/routes/api.dev.simulator.bhs.pending-confirmations.$bagId.confirm.ts"),
  ]);
  assert.match(component, /Pending BHS Diversion Confirmations/);
  assert.match(component, /Confirm Diversion and Send Message 2001/);
  assert.match(component, /readOnly/);
  assert.match(component, /trigger: 1/);
  assert.match(api, /handleBhsPendingConfirmationsRequest/);
  assert.match(api, /handleBhsPendingConfirmationRequest/);
  assert.match(api, /getPending\(bagId\)/);
  assert.match(api, /bhsUid: pending\.bhsUid/);
  assert.match(api, /evaluation: pending\.screeningEvaluationRaw/);
  assert.match(api, /"simulator\.use"/);
  assert.doesNotMatch(component + api, /BHS_INTEGRATION_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(pendingRoute, /handleBhsPendingConfirmationsRequest/);
  assert.match(confirmRoute, /handleBhsPendingConfirmationRequest/);
});

test("safe-only duplicate repair reports conflicts and repoints the allowed references", async () => {
  const migration = await read(
    "supabase/migrations/024_beltcon_hbss_bhs_correlation_and_tagging_readiness.sql",
  );
  assert.match(migration, /beltcon_bhs_duplicate_identity_report_v1/);
  assert.match(migration, /repair_beltcon_safe_bhs_duplicate_v1/);
  assert.match(migration, /PREFER_CONFIRMED_THEN_OLDEST/);
  assert.match(migration, /public\.alarms/);
  assert.match(migration, /public\.resolutions/);
  assert.match(migration, /public\.hbss_recall_requests/);
  assert.match(migration, /public\.rfid_events/);
  assert.match(
    migration,
    /UPDATE public\.screening_integration_events SET bag_id = v_canonical\.id/,
  );
  assert.match(migration, /UPDATE public\.xray_scans SET bag_id = v_canonical\.id/);
  assert.match(migration, /BAG_IDENTITY_MERGED/);
  assert.match(migration, /BAG_IDENTITY_CONFLICT/);
  assert.match(migration, /DELETE FROM public\.bags WHERE id = v_duplicate\.id/);
});
