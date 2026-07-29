import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => new URL(`../${relativePath}`, import.meta.url);

test("Baseline V1 primary simulator contract preserves the BHS BagID through tagging eligibility", async () => {
  const [schemas, mappers] = await Promise.all([
    readFile(source("src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts"), "utf8"),
    readFile(source("src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers.ts"), "utf8"),
  ]);

  assert.match(schemas, /messageType: z\.literal\(BHS_BAG_MESSAGE_TYPE_V1\)/);
  assert.match(schemas, /bhsUid: BhsUidSchema/);
  assert.match(schemas, /evaluation: RawScreeningEvaluationSchema/);
  assert.match(mappers, /R: "REJECT"/);
  assert.match(mappers, /createSemanticAcknowledgement/);
  assert.match(mappers, /BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1/);
});

test("Baseline V1 accepts only eligible non-accept evaluations and keeps tag identities distinct", async () => {
  const [constants, schemas, migration] = await Promise.all([
    readFile(source("src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.constants.ts"), "utf8"),
    readFile(source("src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts"), "utf8"),
    readFile(source("supabase/migrations/018_create_beltcon_rfid_tag_assignment.sql"), "utf8"),
  ]);

  assert.match(
    constants,
    /TAGGING_ELIGIBLE_EVALUATIONS = \[\s*"REJECT",\s*"TIMEOUT",\s*"NO_DECISION",\s*"MISTRACK"/s,
  );
  assert.match(schemas, /rfidTagBarcode: z\.string\(\)/);
  assert.match(schemas, /epc: z\.string\(\)/);
  assert.match(migration, /SET epc = v_epc, rfid_tag_barcode = v_barcode/);
});

test("simulator support never enables physical BHS or HBSS transport", async () => {
  const featureFlags = await readFile(
    source("src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags.ts"),
    "utf8",
  );

  assert.match(featureFlags, /FEATURE_BHS_SIMULATOR: true/);
  assert.match(featureFlags, /FEATURE_RFID_SIMULATOR: true/);
  assert.match(featureFlags, /FEATURE_HBSS_SIMULATOR: true/);
  assert.match(featureFlags, /FEATURE_BHS_PROFINET_ADAPTER: false/);
  assert.match(featureFlags, /FEATURE_HBSS_RS232_ADAPTER: false/);
  assert.match(featureFlags, /FEATURE_BHS_SIMULATOR: false/);
  assert.match(featureFlags, /FEATURE_HBSS_SIMULATOR: false/);
});
