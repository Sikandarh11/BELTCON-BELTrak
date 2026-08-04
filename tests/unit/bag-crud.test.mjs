import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import { createProjectModuleLoader, repositoryRoot } from "../helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
after(() => loader.close());
const [baselineSchemas, taggingService] = await Promise.all([
  loader.load("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts"),
  loader.load("/src/services/bags/taggingService.server.ts"),
]);

const [coreSql, screeningSql, taggingSql, recheckSql, bagMappingsSource, routeNames] =
  await Promise.all([
    readFile(path.join(repositoryRoot, "supabase/migrations/003_create_core_tables.sql"), "utf8"),
    readFile(
      path.join(repositoryRoot, "supabase/migrations/007_create_screening_ingestion.sql"),
      "utf8",
    ),
    readFile(
      path.join(
        repositoryRoot,
        "supabase/migrations/024_beltcon_hbss_bhs_correlation_and_tagging_readiness.sql",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        repositoryRoot,
        "supabase/migrations/021_create_beltcon_recheck_hbss_resolution_workflow.sql",
      ),
      "utf8",
    ),
    readFile(path.join(repositoryRoot, "src/services/bagPersistenceMappings.ts"), "utf8"),
    readdir(path.join(repositoryRoot, "src/routes")),
  ]);

test("real identifier schemas reject partial, empty, malformed, and oversized values", () => {
  assert.equal(baselineSchemas.BhsUidSchema.safeParse("").success, false);
  assert.equal(baselineSchemas.BhsUidSchema.safeParse("BHS00000012").success, false);
  assert.equal(baselineSchemas.IataLpcSchema.safeParse("12345").success, false);
  assert.equal(baselineSchemas.IataLpcSchema.safeParse("012345678A").success, false);
  assert.equal(
    baselineSchemas.RfidTagAssociationRequestSchema.safeParse({
      bagId: "ETB-P1-003",
      rfidTagBarcode: "TAG-P1-003",
      epc: "E".repeat(257),
      expectedVersion: 1,
    }).success,
    false,
  );
});

test("real tagging validation normalizes EPC and rejects unsupported input before persistence", () => {
  assert.equal(taggingService.normalizeEpc(" e280117000000003 "), "E280117000000003");
  assert.throws(() => taggingService.normalizeEpc(""), /EPC is required/);
  assert.throws(() => taggingService.normalizeEpc("EPC WITH SPACE"), /only contain/);
  assert.throws(() => taggingService.normalizeEpc("E".repeat(129)), /128/);
});

test("database guards use exact uniqueness and optimistic versions", () => {
  assert.match(
    screeningSql,
    /UNIQUE INDEX IF NOT EXISTS idx_bags_source_bhs_uid[\s\S]*\(source_system, bhs_uid\)/i,
  );
  assert.match(taggingSql, /idx_bags_epc_normalized_unique/);
  assert.match(taggingSql, /idx_bags_rfid_tag_barcode_active_unique/);
  assert.match(taggingSql, /WHERE id=v_bag_id AND version=p_expected_version/);
  assert.match(recheckSql, /v_bag\.version <> p_expected_bag_version/);
});

test("the current application exposes no generic bag CRUD route or server service", () => {
  assert.equal(
    routeNames.some((name) => /^api\.bags\.(create|update|delete)\./.test(name)),
    false,
  );
  assert.ok(routeNames.includes("api.bags.pending-tagging.ts"));
  assert.ok(routeNames.includes("api.bags.rfid-trackable.ts"));
});

test("current database policy has no bag DELETE policy and uses text bag IDs", () => {
  assert.match(coreSql, /id text primary key/i);
  assert.doesNotMatch(coreSql, /create policy[^;]+bags[^;]+for delete/is);
  assert.doesNotMatch(coreSql, /on public\.bags[^;]+on delete/is);
});

test("production bag timestamp mapping still owns an uninjected system clock", () => {
  assert.match(bagMappingsSource, /updated_at: bag\.updatedAt \?\? new Date\(\)\.toISOString\(\)/);
});

const missingCrudScenarios = [
  "create a valid suspect bag and produce BAG_CREATED",
  "reject missing BHS UID when required",
  "reject duplicate BHS UID under the approved identity scope",
  "reject duplicate active EPC through generic bag creation",
  "accept a bag without EPC before tagging",
  "record created_by and created_at on generic creation",
  "retrieve by exact internal bag ID",
  "retrieve by exact BHS UID",
  "retrieve by exact IATA code",
  "retrieve by exact EPC",
  "return BAG_NOT_FOUND for every unknown identifier",
  "allow only approved generic operational-field updates",
  "reject direct status changes that bypass the state machine",
  "reject unauthorized threat-level changes",
  "audit old and new generic bag values",
  "preserve immutable bag identifiers",
  "operational users cannot permanently delete bags",
  "administrator deletion follows an explicit archive or deletion policy",
  "archive or deletion writes an audit event",
  "generic bag schema rejects malformed UUID timestamps and unexpected fields",
];

for (const scenario of missingCrudScenarios) {
  test(
    scenario,
    {
      todo: "No generic production bag CRUD service, repository interface, API, or bag schema exists",
    },
    () => {},
  );
}
