import { TEST_NOW } from "./bagFixtures.mjs";

export function createTagFixture(overrides = {}) {
  return {
    id: "TAG-P1-001",
    bag_id: "ETB-P1-003",
    epc: "E280117000000003",
    barcode: "TAG-P1-003",
    status: "ASSIGNED",
    assigned_at: TEST_NOW,
    assigned_by: "00000000-0000-4000-8000-000000000002",
    fixture_validity: { valid: true, reason: "Valid non-production RFID tag" },
    ...overrides,
  };
}

export function createRfidEvent(overrides = {}) {
  return {
    sourceEventId: "RFID-EVENT-P1-001",
    readerId: "RDR-TAG-001",
    antennaPort: 1,
    epc: "E280117000000003",
    readAt: TEST_NOW,
    rssiDbm: -45,
    deviceSequence: 1,
    bootId: "BOOT-P1-001",
    ...overrides,
  };
}
