import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  createTaggedBag,
  standardBagFixtures,
  threatLevelFixtures,
} from "../fixtures/bagFixtures.mjs";
import { createBhsMessage } from "../fixtures/bhsFixtures.mjs";
import { createHbssScan, createXrayImage } from "../fixtures/hbssFixtures.mjs";
import { requiredZoneMapping, standardReaderFixtures } from "../fixtures/readerFixtures.mjs";
import { createRfidEvent } from "../fixtures/tagFixtures.mjs";
import { standardUserFixtures } from "../fixtures/userFixtures.mjs";
import { createProjectModuleLoader } from "../helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
after(() => loader.close());

const [
  baselineSchemas,
  screeningSchemas,
  screeningTypes,
  hbssSchemas,
  rfidSchemas,
  readerSchemas,
  roleModule,
  userSchemas,
] = await Promise.all([
  loader.load("/src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas.ts"),
  loader.load("/src/services/integrations/screening/screeningSchemas.ts"),
  loader.load("/src/types/screening.ts"),
  loader.load("/src/services/integrations/hbss/hbssSchemas.ts"),
  loader.load("/src/services/rfid/rfidReadSchemas.ts"),
  loader.load("/src/services/readers/readerSchemas.ts"),
  loader.load("/src/auth/canonicalRoles.ts"),
  loader.load("/src/services/admin/users/adminUserSchemas.ts"),
]);

function screeningInputForBag(bag, index) {
  const available = bag.xray_status === "AVAILABLE";
  return {
    eventId: `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`,
    bhsUid: bag.bhs_uid,
    iataCode: bag.iata_code,
    iataOrigin: bag.iata_origin,
    flightNo: bag.flight_number,
    passengerName: "Synthetic Test Bag",
    threatType: bag.threat_type,
    threatLevel: bag.threat_level,
    screeningEvaluationRaw: "R",
    screeningStation: "HBSS-TEST-01",
    screeningTimestamp: bag.created_at,
    externalScanId: `XRAY-P1-${String(index + 1).padStart(3, "0")}`,
    scanStatus: available ? "AVAILABLE" : "NOT_FOUND",
    imageSetId: available ? "fixture-set" : null,
    images: available ? [createXrayImage()] : [],
  };
}

test("all 15 bag fixtures have unique production identifiers and deterministic timestamps", () => {
  assert.equal(standardBagFixtures.length, 15);
  assert.equal(new Set(standardBagFixtures.map((bag) => bag.id)).size, 15);
  assert.equal(new Set(standardBagFixtures.map((bag) => bag.bhs_uid)).size, 15);
  const epcs = standardBagFixtures.map((bag) => bag.rfid_epc).filter(Boolean);
  assert.equal(new Set(epcs).size, epcs.length);
  for (const bag of standardBagFixtures) {
    assert.equal(bag.fixture_validity.valid, true);
    assert.equal(new Date(bag.created_at).toISOString(), bag.created_at);
    assert.equal(new Date(bag.updated_at).toISOString(), bag.updated_at);
  }
});

test("standard bags pass every applicable real BHS, IATA, screening, and RFID schema", () => {
  standardBagFixtures.forEach((bag, index) => {
    assert.equal(baselineSchemas.BhsUidSchema.parse(bag.bhs_uid), bag.bhs_uid);
    assert.equal(baselineSchemas.IataLpcSchema.parse(bag.iata_code), bag.iata_code);
    screeningSchemas.screeningSimulatorInputSchema.parse(screeningInputForBag(bag, index));
    if (bag.rfid_epc) {
      baselineSchemas.RfidTagAssociationRequestSchema.parse({
        bagId: bag.id,
        rfidTagBarcode: bag.rfid_tag_barcode,
        epc: bag.rfid_epc,
        iataLpc: bag.iata_code,
        expectedVersion: bag.version,
      });
    }
  });
});

test("builders provide safe defaults and preserve explicit overrides", () => {
  const bag = createTaggedBag({
    epc: "E280117000000001",
    threat_level: 4,
    status: "TAGGED",
  });
  assert.equal(bag.rfid_epc, "E280117000000001");
  assert.equal(bag.threat_level, 4);
  assert.equal(bag.status, "TAGGED");
  assert.equal(bag.flight_number, "SV103");
});

test("BHS, X-ray, and RFID event builders pass their real project schemas", () => {
  baselineSchemas.BhsBagMessageV1Schema.parse(createBhsMessage());
  screeningTypes.screeningImageV1Schema.parse(createXrayImage());
  hbssSchemas.hbssScanResultSchema.parse(createHbssScan());
  rfidSchemas.rfidReadSchema.parse(createRfidEvent());
});

test("all reader fixtures use the actual registered zone vocabulary", () => {
  assert.deepEqual(Object.keys(requiredZoneMapping), [
    "TAGGING",
    "RECLAIM_BELT",
    "WASHROOM",
    "LOST_AND_FOUND",
    "EMPLOYEE_EXIT",
    "EMERGENCY_DOOR",
    "CUSTOMS_EXIT",
    "RECHECK",
  ]);
  for (const zone of Object.values(requiredZoneMapping)) {
    assert.ok(readerSchemas.READER_ZONES.includes(zone));
  }
  for (const reader of standardReaderFixtures) {
    rfidSchemas.readerAntennaMapSchema.parse({
      readerId: reader.readerId,
      readerName: reader.readerName,
      readerStatus: reader.readerStatus,
      antennaId: reader.antennaId,
      antennaPort: reader.antennaPort,
      antennaName: reader.antennaName,
      zoneCode: reader.zoneCode,
      direction: reader.direction,
      enabled: reader.enabled,
    });
  }
  assert.equal(standardReaderFixtures.at(-1).fixture_validity.valid, false);
});

test("user fixtures use real canonical roles and account statuses", () => {
  for (const user of standardUserFixtures) {
    roleModule.canonicalRoleSchema.parse(user.role);
    userSchemas.adminUserStatusSchema.parse(user.status);
    assert.match(user.email, /@example\.invalid$/);
  }
  assert.equal(standardUserFixtures.length, 7);
});

test("threat fixtures cover exactly the real schema range 1 through 5", () => {
  assert.deepEqual(
    threatLevelFixtures.map(({ level }) => level),
    [1, 2, 3, 4, 5],
  );
  for (const { level } of threatLevelFixtures) {
    screeningSchemas.screeningSimulatorInputSchema.parse({
      ...screeningInputForBag(standardBagFixtures[0], level),
      threatLevel: level,
    });
  }
});
