export const TEST_NOW = "2026-07-30T10:00:00.000Z";
export const TEST_TAGGED_AT = "2026-07-30T10:05:00.000Z";

const TAGGING_OPERATOR_ID = "00000000-0000-4000-8000-000000000002";

function createBagFixture({
  sequence,
  expectedStatus,
  status,
  zone,
  tagged = false,
  overrides = {},
}) {
  const suffix = String(sequence).padStart(7, "0");
  const epc = tagged ? `E280117${String(sequence).padStart(9, "0")}` : null;
  const fixture = {
    id: `ETB-P1-${String(sequence).padStart(3, "0")}`,
    bhs_uid: `BHS${suffix}`,
    iata_code: String(sequence).padStart(10, "0"),
    rfid_epc: epc,
    // The current database column is bags.epc; rfid_epc is retained because it
    // is the name used by the Phase 1 fixture contract.
    epc,
    rfid_tag_barcode: tagged ? `TAG-P1-${String(sequence).padStart(3, "0")}` : null,
    threat_level: ((sequence - 1) % 5) + 1,
    threat_type: "SIMULATED_TEST_ANOMALY",
    status,
    expected_lifecycle_status: expectedStatus,
    flight_number: `SV${String(100 + sequence)}`,
    origin_airport: "JED",
    iata_origin: "JED",
    tagging_station: "TAGGING-01",
    tagged_at: tagged ? TEST_TAGGED_AT : null,
    tagged_by: tagged ? TAGGING_OPERATOR_ID : null,
    xray_image_path: "/mock-xray/scan-top.svg",
    xray_status: "AVAILABLE",
    last_known_zone: zone,
    created_by: "00000000-0000-4000-8000-000000000001",
    created_at: TEST_NOW,
    updated_at: tagged ? TEST_TAGGED_AT : TEST_NOW,
    version: 1,
    fixture_validity: {
      valid: true,
      reason: "Valid deterministic non-production fixture",
    },
    ...overrides,
  };

  if (Object.hasOwn(overrides, "rfid_epc") && !Object.hasOwn(overrides, "epc")) {
    fixture.epc = overrides.rfid_epc;
  }
  if (Object.hasOwn(overrides, "epc") && !Object.hasOwn(overrides, "rfid_epc")) {
    fixture.rfid_epc = overrides.epc;
  }
  return fixture;
}

export function createSuspectBag(overrides = {}) {
  return createBagFixture({
    sequence: 1,
    expectedStatus: "SUSPECT",
    status: "IDENTIFIED",
    zone: "TAGGING",
    overrides,
  });
}

export function createDivertedBag(overrides = {}) {
  return createBagFixture({
    sequence: 2,
    expectedStatus: "DIVERTED",
    status: "IDENTIFIED",
    zone: "TAGGING",
    overrides: {
      bhs_confirmation_status: "CONFIRMED",
      ...overrides,
    },
  });
}

export function createTaggedBag(overrides = {}) {
  return createBagFixture({
    sequence: 3,
    expectedStatus: "TAGGED",
    status: "TAGGED",
    zone: "TAGGING",
    tagged: true,
    overrides,
  });
}

export function createInHallBag(overrides = {}) {
  return createBagFixture({
    sequence: 4,
    expectedStatus: "IN_HALL",
    status: "IN_ARRIVAL_HALL",
    zone: "RECLAIM",
    tagged: true,
    overrides,
  });
}

export function createAtExitBag(overrides = {}) {
  return createBagFixture({
    sequence: 5,
    expectedStatus: "AT_EXIT",
    status: "AT_EXIT",
    zone: "CUSTOMS_EXIT",
    tagged: true,
    overrides,
  });
}

export function createAlarmedBag(overrides = {}) {
  return createBagFixture({
    sequence: 6,
    expectedStatus: "ALARMED",
    status: "ALARMED",
    zone: "CUSTOMS_EXIT",
    tagged: true,
    overrides: { alarm_id: "ALARM-P1-006", ...overrides },
  });
}

export function createRecheckBag(overrides = {}) {
  return createBagFixture({
    sequence: 7,
    expectedStatus: "RECHECK",
    status: "UNDER_RECHECK",
    zone: "RECHECK",
    tagged: true,
    overrides: { alarm_id: "ALARM-P1-007", ...overrides },
  });
}

export function createClearedBag(overrides = {}) {
  return createBagFixture({
    sequence: 8,
    expectedStatus: "CLEARED",
    status: "RESOLVED",
    zone: "RECHECK",
    tagged: true,
    overrides: { resolution_disposition: "CLEARED", ...overrides },
  });
}

export function createConfiscatedBag(overrides = {}) {
  return createBagFixture({
    sequence: 9,
    expectedStatus: "CONFISCATED",
    status: "RESOLVED",
    zone: "RECHECK",
    tagged: true,
    overrides: { resolution_disposition: "PROHIBITED_ITEM_SEIZED", ...overrides },
  });
}

export function createEscalatedBag(overrides = {}) {
  return createBagFixture({
    sequence: 10,
    expectedStatus: "ESCALATED",
    status: "ESCALATED",
    zone: "RECHECK",
    tagged: true,
    overrides,
  });
}

export function createClosedBag(overrides = {}) {
  return createBagFixture({
    sequence: 11,
    expectedStatus: "CLOSED",
    status: "RESOLVED",
    zone: "RECHECK",
    tagged: true,
    overrides: {
      resolution_disposition: "CLEARED",
      closed_at: "2026-07-30T10:20:00.000Z",
      updated_at: "2026-07-30T10:20:00.000Z",
      ...overrides,
    },
  });
}

export function createFailedRfidTagBag(overrides = {}) {
  return createBagFixture({
    sequence: 12,
    expectedStatus: "DIVERTED",
    status: "IDENTIFIED",
    zone: "TAGGING",
    overrides: {
      tag_assignment: { outcome: "FAILED", failure_code: "RFID_ENCODING_FAILED" },
      ...overrides,
    },
  });
}

export function createReplacementRfidTagBag(overrides = {}) {
  return createBagFixture({
    sequence: 13,
    expectedStatus: "TAGGED",
    status: "TAGGED",
    zone: "TAGGING",
    tagged: true,
    overrides: {
      tag_assignment: {
        outcome: "REPLACED",
        previous_epc: "E280117000000099",
      },
      ...overrides,
    },
  });
}

export function createOutOfGaugeBag(overrides = {}) {
  return createBagFixture({
    sequence: 14,
    expectedStatus: "SUSPECT",
    status: "IDENTIFIED",
    zone: "TAGGING",
    overrides: { out_of_gauge: true, ...overrides },
  });
}

export function createMissingXrayBag(overrides = {}) {
  return createBagFixture({
    sequence: 15,
    expectedStatus: "SUSPECT",
    status: "IDENTIFIED",
    zone: "TAGGING",
    overrides: {
      xray_image_path: null,
      xray_status: "NOT_FOUND",
      ...overrides,
    },
  });
}

export const standardBagFixtures = Object.freeze([
  createSuspectBag(),
  createDivertedBag(),
  createTaggedBag(),
  createInHallBag(),
  createAtExitBag(),
  createAlarmedBag(),
  createRecheckBag(),
  createClearedBag(),
  createConfiscatedBag(),
  createEscalatedBag(),
  createClosedBag(),
  createFailedRfidTagBag(),
  createReplacementRfidTagBag(),
  createOutOfGaugeBag(),
  createMissingXrayBag(),
]);

export const threatLevelFixtures = Object.freeze(
  [1, 2, 3, 4, 5].map((level) => ({
    level,
    label: `Level ${level}`,
    fixture_validity: { valid: true, reason: "Accepted by the current 1-5 schema" },
  })),
);
