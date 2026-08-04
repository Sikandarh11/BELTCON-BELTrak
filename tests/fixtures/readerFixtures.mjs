const READER_BASE = Object.freeze({
  readerStatus: "ONLINE",
  antennaPort: 1,
  direction: "BIDIRECTIONAL",
  enabled: true,
  registered: true,
  fixture_validity: { valid: true, reason: "Valid non-production reader fixture" },
});

function reader(sequence, readerId, readerName, zoneCode, overrides = {}) {
  return {
    ...READER_BASE,
    readerId,
    readerName,
    antennaId: `00000000-0000-4000-8001-${String(sequence).padStart(12, "0")}`,
    antennaName: `${readerName} port 1`,
    zoneCode,
    ...overrides,
  };
}

export const createTaggingStationReader = (overrides = {}) =>
  reader(1, "RDR-TAG-001", "Tagging station reader", "TAGGING", overrides);
export const createReclaimBeltReader = (overrides = {}) =>
  reader(2, "RDR-RCL-001", "Reclaim belt reader", "RECLAIM", overrides);
export const createWashroomReader = (overrides = {}) =>
  reader(3, "RDR-WSH-001", "Washroom reader", "WASHROOM", overrides);
export const createLostAndFoundReader = (overrides = {}) =>
  reader(4, "RDR-LAF-001", "Lost-and-found reader", "LOST_AND_FOUND", overrides);
export const createEmployeeExitReader = (overrides = {}) =>
  reader(5, "RDR-EMP-001", "Employee-exit reader", "EMPLOYEE_EXIT", overrides);
export const createEmergencyDoorReader = (overrides = {}) =>
  reader(6, "RDR-EMR-001", "Emergency-door reader", "EMERGENCY_EXIT", {
    requested_zone: "EMERGENCY_DOOR",
    ...overrides,
  });
export const createCustomsExitReader = (overrides = {}) =>
  reader(7, "RDR-CUS-001", "Customs exit portal reader", "CUSTOMS_EXIT", overrides);
export const createRecheckReader = (overrides = {}) =>
  reader(8, "RDR-RCK-001", "Recheck station reader", "RECHECK", overrides);
export const createOfflineReader = (overrides = {}) =>
  reader(9, "RDR-OFF-001", "Offline reader", "OTHER", {
    readerStatus: "OFFLINE",
    enabled: false,
    ...overrides,
  });
export const createUnregisteredReader = (overrides = {}) =>
  reader(10, "RDR-UNREG-001", "Unregistered reader", "OTHER", {
    readerStatus: "UNKNOWN",
    registered: false,
    fixture_validity: {
      valid: false,
      reason: "Intentionally invalid operational fixture: reader is not registered",
    },
    ...overrides,
  });

export const standardReaderFixtures = Object.freeze([
  createTaggingStationReader(),
  createReclaimBeltReader(),
  createWashroomReader(),
  createLostAndFoundReader(),
  createEmployeeExitReader(),
  createEmergencyDoorReader(),
  createCustomsExitReader(),
  createRecheckReader(),
  createOfflineReader(),
  createUnregisteredReader(),
]);

export const requiredZoneMapping = Object.freeze({
  TAGGING: "TAGGING",
  RECLAIM_BELT: "RECLAIM",
  WASHROOM: "WASHROOM",
  LOST_AND_FOUND: "LOST_AND_FOUND",
  EMPLOYEE_EXIT: "EMPLOYEE_EXIT",
  EMERGENCY_DOOR: "EMERGENCY_EXIT",
  CUSTOMS_EXIT: "CUSTOMS_EXIT",
  RECHECK: "RECHECK",
});
