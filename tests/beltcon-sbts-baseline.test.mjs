import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
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

const [mappers, schemas, constants, flags] = await Promise.all([
  vite.ssrLoadModule("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.mappers.ts"),
  vite.ssrLoadModule("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts"),
  vite.ssrLoadModule("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.constants.ts"),
  vite.ssrLoadModule("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags.ts"),
]);

const validMessage = {
  messageType: 2001,
  trigger: 1,
  lineId: "L1",
  bhsUid: "AB12-CD3E4",
  evaluation: "R",
};

test("BHS BagID accepts exactly 10 printable ASCII characters and preserves it", () => {
  const value = "AB12-CD3E4";
  assert.equal(mappers.validateBhsUid(value), value);
  assert.equal(
    schemas.BhsBagMessageV1Schema.parse({ ...validMessage, bhsUid: value }).bhsUid,
    value,
  );
});

test("BHS BagID rejects invalid length, Unicode, control characters, and invalid ETB fallback", () => {
  for (const value of ["123456789", "12345678901", "AB12-\u00c7D3E4", "AB12\nCD3E4", "ETB-24007"]) {
    assert.throws(() => mappers.validateBhsUid(value));
  }
});

test("BHS Line ID requires exactly two printable ASCII characters", () => {
  assert.equal(mappers.validateBhsLineId("L1"), "L1");
  for (const value of ["L", "L12", "L\n"]) {
    assert.throws(() => mappers.validateBhsLineId(value));
  }
});

test("screening evaluations normalize exactly and reject unknown values", () => {
  assert.equal(mappers.normalizeScreeningEvaluation("A"), "ACCEPT");
  assert.equal(mappers.normalizeScreeningEvaluation("R"), "REJECT");
  assert.equal(mappers.normalizeScreeningEvaluation("T"), "TIMEOUT");
  assert.equal(mappers.normalizeScreeningEvaluation("N"), "NO_DECISION");
  assert.equal(mappers.normalizeScreeningEvaluation("?"), "MISTRACK");
  assert.throws(() => mappers.normalizeScreeningEvaluation("X"));
});

test("only non-accept screening evaluations enter the Tagging Queue", () => {
  assert.equal(mappers.isTaggingEligibleEvaluation("ACCEPT"), false);
  assert.equal(mappers.isTaggingEligibleEvaluation("REJECT"), true);
  assert.equal(mappers.isTaggingEligibleEvaluation("TIMEOUT"), true);
  assert.equal(mappers.isTaggingEligibleEvaluation("NO_DECISION"), true);
  assert.equal(mappers.isTaggingEligibleEvaluation("MISTRACK"), true);
});

test("IATA LPC accepts absent or ten numeric digits and rejects airport codes", () => {
  assert.equal(mappers.validateIataLpc(undefined), undefined);
  assert.equal(mappers.validateIataLpc(null), null);
  assert.equal(mappers.validateIataLpc("0123456789"), "0123456789");
  for (const value of ["RUH", "012345678A", "012345678", "01234567890"]) {
    assert.throws(() => mappers.validateIataLpc(value));
  }
});

test("feature defaults keep real hardware disabled and do not depend on workspace mode", () => {
  const development = flags.getBeltconSbtsBaselineFeatureFlags("development");
  const production = flags.getBeltconSbtsBaselineFeatureFlags("production");

  assert.equal(development.FEATURE_BELTCON_SBTS_BASELINE_V1, true);
  assert.equal(development.FEATURE_BHS_SIMULATOR, true);
  assert.equal(development.FEATURE_HBSS_SIMULATOR, true);
  assert.equal(production.FEATURE_BHS_SIMULATOR, false);
  assert.equal(production.FEATURE_HBSS_SIMULATOR, false);
  assert.equal(production.FEATURE_BHS_PROFINET_ADAPTER, false);
  assert.equal(production.FEATURE_HBSS_RS232_ADAPTER, false);
  assert.equal(flags.getBeltconSbtsBaselineFeatureFlags.length, 1);
});

test("fingerprints are deterministic and include all normalized BHS contract fields", () => {
  const same = { ...validMessage };
  assert.equal(
    mappers.createBhsMessageFingerprint(validMessage),
    mappers.createBhsMessageFingerprint(same),
  );
  assert.notEqual(
    mappers.createBhsMessageFingerprint(validMessage),
    mappers.createBhsMessageFingerprint({ ...validMessage, bhsUid: "ZX98-YW7V6" }),
  );
  assert.notEqual(
    mappers.createBhsMessageFingerprint(validMessage),
    mappers.createBhsMessageFingerprint({ ...validMessage, evaluation: "T" }),
  );
  assert.notEqual(
    mappers.createBhsMessageFingerprint(validMessage),
    mappers.createBhsMessageFingerprint({ ...validMessage, lineId: "L2" }),
  );
});

test("semantic acknowledgements use message 2002 and wait for durable commit", () => {
  const acknowledgement = mappers.createSemanticAcknowledgement("AB12-CD3E4", "DUPLICATE");
  assert.equal(acknowledgement.messageType, constants.BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1);
  assert.equal(acknowledgement.timing, "AFTER_DURABLE_COMMIT");
  assert.equal(acknowledgement.outcome, "DUPLICATE");
});

test("baseline domain files remain browser-safe and free of hardware imports", async () => {
  const files = [
    "beltconSbtsBaseline.constants.ts",
    "beltconSbtsBaseline.types.ts",
    "beltconSbtsBaseline.schemas.ts",
    "beltconSbtsBaseline.mappers.ts",
    "beltconSbtsBaseline.featureFlags.ts",
    "beltconSbtsBaseline.adapters.ts",
  ];

  for (const file of files) {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(repositoryRoot, "src/domain/beltcon-sbts-baseline", file), "utf8"),
    );
    assert.doesNotMatch(source, /(?:from|import)\s*["'](?:node:|serialport|net|child_process)/i);
  }
});
