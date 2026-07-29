import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(
  repositoryRoot,
  "supabase",
  "migrations",
  "016_beltcon_sbts_baseline_identity_and_messages.sql",
);
const migration = await readFile(migrationPath, "utf8");
const migrationFiles = await readdir(path.join(repositoryRoot, "supabase", "migrations"));
const forbiddenBrandTerms = ["tr" + "ack" + "it", "en" + "track" + "bag"];

const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(repositoryRoot, "src") } },
});

test.after(async () => {
  await vite.close();
});

const { bagToRow, rowToBag, validateBeltconSbtsBaselineBag } = await vite.ssrLoadModule(
  "/src/services/bagPersistenceMappings.ts",
);
const { BhsBagMessageV1Schema } = await vite.ssrLoadModule(
  "/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts",
);

test("migration 016 is additive and preserves the 001–015 migration set", () => {
  assert.ok(migrationFiles.includes("016_beltcon_sbts_baseline_identity_and_messages.sql"));
  for (let number = 1; number <= 15; number += 1) {
    assert.ok(
      migrationFiles.some((file) => file.startsWith(`${String(number).padStart(3, "0")}_`)),
    );
  }
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS bhs_line_id/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS screening_evaluation/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS screening_evaluation_raw/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS rfid_tag_barcode/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1/i);
});

test("migration constrains the BELTCON SBTS BHS identity, IATA LPC, version, and RFID barcode", () => {
  assert.match(migration, /octet_length\(bhs_uid\) = 10/i);
  assert.match(migration, /char_length\(bhs_uid\) = 10/i);
  assert.match(migration, /bhs_uid ~ '\^\[ -~\]\{10\}\$'/i);
  assert.match(migration, /bhs_uid !~\* '\^ETB-'/i);
  assert.match(migration, /bags_beltcon_sbts_bhs_line_id_format/i);
  assert.match(migration, /bhs_line_id ~ '\^\[ -~\]\{2\}\$'/i);
  assert.match(migration, /iata_code IS NULL OR iata_code ~ '\^\[0-9\]\{10\}\$'/i);
  assert.match(migration, /CHECK \(version >= 1\)/i);
  assert.match(migration, /btrim\(rfid_tag_barcode\) <> ''/i);
  assert.match(migration, /char_length\(rfid_tag_barcode\) <= 128/i);
});

test("migration enforces raw and normalized screening evaluation pairs", () => {
  for (const [raw, normalized] of [
    ["A", "ACCEPT"],
    ["R", "REJECT"],
    ["T", "TIMEOUT"],
    ["N", "NO_DECISION"],
    ["?", "MISTRACK"],
  ]) {
    assert.match(
      migration,
      new RegExp(
        `screening_evaluation_raw = '${raw.replace("?", "\\?")}' AND screening_evaluation = '${normalized}'`,
      ),
    );
  }
  assert.match(migration, /NOT VALID/i);
});

test("migration extends integration events with semantic message and acknowledgement support", () => {
  for (const column of [
    "protocol_name",
    "protocol_version",
    "message_type",
    "message_direction",
    "bhs_line_id",
    "screening_evaluation",
    "screening_evaluation_raw",
    "message_fingerprint",
    "acknowledgement_outcome",
    "acknowledgement_timing",
    "acknowledged_at",
    "processing_attempt_count",
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, "i"));
  }
  assert.match(migration, /message_type IS NULL OR message_type IN \(2001, 2002\)/i);
  assert.match(migration, /'ACCEPTED', 'DUPLICATE', 'REJECTED', 'FAILED'/i);
  assert.match(migration, /acknowledgement_timing = 'AFTER_DURABLE_COMMIT'/i);
  assert.match(migration, /processing_attempt_count >= 0/i);
  assert.match(migration, /idx_screening_events_bhs_message_fingerprint/i);
});

test("BELTCON SBTS baseline product files contain no legacy vendor branding", async () => {
  const productFiles = [
    "docs/architecture/ADR-BELTCON-SBTS-BASELINE-V1.md",
    "docs/database/BELTCON-SBTS-MIGRATION-016-VERIFICATION.md",
    "supabase/migrations/016_beltcon_sbts_baseline_identity_and_messages.sql",
    "src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.adapters.ts",
    "src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.constants.ts",
    "src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags.ts",
    "src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers.ts",
    "src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts",
    "src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types.ts",
    "src/services/bagPersistenceMappings.ts",
    "src/types/bag.ts",
    "tests/beltcon-sbts-baseline.test.mjs",
    "tests/beltcon-sbts-baseline-migration.test.mjs",
  ];

  for (const relativePath of productFiles) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    for (const term of forbiddenBrandTerms) {
      assert.doesNotMatch(source, new RegExp(term, "i"), relativePath);
    }
  }
});

test("database rows map baseline identity fields without fabricating identifiers", () => {
  const row = bagToRow({
    id: "ETB-BASELINE-01",
    sourceSystem: "BELTCON_BHS",
    bhsUid: "AB12-CD3E4",
    bhsLineId: "L1",
    iataLpc: "0123456789",
    rfidTagBarcode: "LABEL-0001",
    screeningEvaluationRaw: "R",
    screeningEvaluation: "REJECT",
    version: 3,
    flightNo: "SV123",
    status: "IDENTIFIED",
    flaggedAt: "2026-07-28T10:00:00.000Z",
  });

  assert.equal(row.bhs_uid, "AB12-CD3E4");
  assert.equal(row.bhs_line_id, "L1");
  assert.equal(row.iata_code, "0123456789");
  assert.equal(row.rfid_tag_barcode, "LABEL-0001");
  assert.equal(row.screening_evaluation_raw, "R");
  assert.equal(row.screening_evaluation, "REJECT");
  assert.equal(row.version, 3);

  const mapped = rowToBag(row);
  assert.equal(mapped.bhsUid, "AB12-CD3E4");
  assert.equal(mapped.bhsLineId, "L1");
  assert.equal(mapped.iataCode, "0123456789");
  assert.equal(mapped.rfidTagBarcode, "LABEL-0001");
  assert.equal(mapped.screeningEvaluationRaw, "R");
  assert.equal(mapped.screeningEvaluation, "REJECT");
  assert.equal(mapped.version, 3);

  const legacy = bagToRow({
    id: "ETB-LEGACY-01",
    flightNo: "SV124",
    status: "IDENTIFIED",
    flaggedAt: "2026-07-28T10:00:00.000Z",
  });
  assert.equal(legacy.bhs_uid, null);
  assert.notEqual(legacy.bhs_uid, legacy.id);
  assert.equal(legacy.rfid_tag_barcode, null);
});

test("strict baseline DTOs use the Phase 1 schemas and do not cross-copy EPC", () => {
  const baseline = validateBeltconSbtsBaselineBag({
    id: "ETB-BASELINE-02",
    bhsUid: "ZX98-YW7V6",
    bhsLineId: "L2",
    iataLpc: "9876543210",
    screeningEvaluationRaw: "T",
    screeningEvaluation: "TIMEOUT",
    rfidTagBarcode: "LABEL-0002",
    epc: "E2806894",
    version: 1,
    flightNo: "SV125",
    status: "IDENTIFIED",
    flaggedAt: "2026-07-28T10:00:00.000Z",
  });
  assert.equal(baseline.iataCode, "9876543210");
  assert.equal(baseline.rfidTagBarcode, "LABEL-0002");
  assert.notEqual(baseline.rfidTagBarcode, baseline.epc);
  assert.throws(() => validateBeltconSbtsBaselineBag({ ...baseline, bhsUid: "ETB-BASELINE-02" }));
  assert.equal(
    BhsBagMessageV1Schema.safeParse({
      messageType: 2001,
      trigger: 1,
      lineId: baseline.bhsLineId,
      bhsUid: baseline.bhsUid,
      evaluation: baseline.screeningEvaluationRaw,
    }).success,
    true,
  );
});
