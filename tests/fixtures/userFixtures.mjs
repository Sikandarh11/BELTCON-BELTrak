import { TEST_NOW } from "./bagFixtures.mjs";

const ROLE_PERMISSIONS = Object.freeze({
  "Operations Officer": [
    "dashboard.view",
    "bag.read",
    "bag.tag",
    "bag.recheck",
    "bag.resolve",
    "alarm.read",
    "alarm.acknowledge",
    "xray.view",
  ],
  "Control Center Operator": [
    "dashboard.view",
    "bag.read",
    "alarm.read",
    "alarm.acknowledge",
    "rfid.read",
    "reader.view",
  ],
  "Customs Supervisor": [
    "dashboard.view",
    "bag.read",
    "bag.recheck",
    "bag.resolve",
    "alarm.read",
    "alarm.acknowledge",
    "alarm.escalate",
    "alarm.close",
    "xray.view",
  ],
  "Airport Administrator": [
    "dashboard.view",
    "bag.read",
    "bag.manage",
    "reader.view",
    "report.view",
    "user.view",
    "user.update",
    "role.view",
    "settings.read",
    "settings.manage",
    "audit.view",
  ],
  "System Administrator": [
    "dashboard.view",
    "bag.read",
    "bag.manage",
    "bag.tag",
    "bag.recheck",
    "bag.resolve",
    "alarm.read",
    "alarm.acknowledge",
    "alarm.escalate",
    "alarm.close",
    "rfid.read",
    "reader.view",
    "reader.manage",
    "report.view",
    "user.view",
    "user.manage",
    "user.create",
    "user.update",
    "user.activate",
    "user.suspend",
    "user.lock",
    "user.deactivate",
    "user.reset_password",
    "role.view",
    "role.manage",
    "permission.manage",
    "settings.read",
    "settings.manage",
    "audit.view",
    "developer.access",
    "simulator.use",
    "xray.view",
    "xray.refresh",
  ],
});

export function createTestUser(overrides = {}) {
  const role = overrides.role ?? "Operations Officer";
  return {
    id: "00000000-0000-4000-8000-000000000002",
    firstName: "Test",
    lastName: "Operator",
    email: "operator@example.invalid",
    role,
    status: "ACTIVE",
    isActive: true,
    mustChangePassword: false,
    createdAt: TEST_NOW,
    lastLogin: TEST_NOW,
    permissions: [...(ROLE_PERMISSIONS[role] ?? [])],
    authorizationVersion: 1,
    fixture_validity: { valid: true, reason: "Valid non-production account fixture" },
    ...overrides,
  };
}

export function createAdministrator(overrides = {}) {
  return createTestUser({
    id: "00000000-0000-4000-8000-000000000001",
    firstName: "System",
    lastName: "Administrator",
    email: "administrator@example.invalid",
    role: "System Administrator",
    permissions: [...ROLE_PERMISSIONS["System Administrator"]],
    ...overrides,
  });
}

export function createTaggingOperator(overrides = {}) {
  return createTestUser({
    id: "00000000-0000-4000-8000-000000000002",
    firstName: "Tagging",
    lastName: "Operator",
    email: "tagging.operator@example.invalid",
    role: "Operations Officer",
    permissions: ["dashboard.view", "bag.read", "bag.tag", "xray.view"],
    requested_role_label: "tagging operator",
    ...overrides,
  });
}

export function createCustomsOfficer(overrides = {}) {
  return createTestUser({
    id: "00000000-0000-4000-8000-000000000003",
    firstName: "Customs",
    lastName: "Officer",
    email: "customs.officer@example.invalid",
    role: "Operations Officer",
    permissions: [
      "dashboard.view",
      "bag.read",
      "bag.recheck",
      "bag.resolve",
      "alarm.read",
      "alarm.acknowledge",
      "xray.view",
    ],
    requested_role_label: "customs officer",
    ...overrides,
  });
}

export function createSupervisor(overrides = {}) {
  return createTestUser({
    id: "00000000-0000-4000-8000-000000000004",
    firstName: "Customs",
    lastName: "Supervisor",
    email: "supervisor@example.invalid",
    role: "Customs Supervisor",
    permissions: [...ROLE_PERMISSIONS["Customs Supervisor"]],
    ...overrides,
  });
}

export function createControlCentreOperator(overrides = {}) {
  return createTestUser({
    id: "00000000-0000-4000-8000-000000000005",
    firstName: "Control",
    lastName: "Centre",
    email: "control.centre@example.invalid",
    role: "Control Center Operator",
    permissions: [...ROLE_PERMISSIONS["Control Center Operator"]],
    ...overrides,
  });
}

export function createDisabledUser(overrides = {}) {
  return createTestUser({
    id: "00000000-0000-4000-8000-000000000006",
    firstName: "Disabled",
    lastName: "User",
    email: "disabled@example.invalid",
    status: "DEACTIVATED",
    isActive: false,
    permissions: [],
    ...overrides,
  });
}

export function createUserWithoutRequiredPermission(overrides = {}) {
  return createTestUser({
    id: "00000000-0000-4000-8000-000000000007",
    firstName: "Limited",
    lastName: "User",
    email: "limited@example.invalid",
    permissions: ["dashboard.view"],
    ...overrides,
  });
}

export function createMockAuthenticatedSession(user = createTestUser(), overrides = {}) {
  return {
    token: "p1-test-access-token",
    expiresAt: "2026-07-30T18:00:00.000Z",
    workspaceMode: "Operator",
    user,
    ...overrides,
  };
}

export const standardUserFixtures = Object.freeze([
  createAdministrator(),
  createTaggingOperator(),
  createCustomsOfficer(),
  createSupervisor(),
  createControlCentreOperator(),
  createDisabledUser(),
  createUserWithoutRequiredPermission(),
]);

export { ROLE_PERMISSIONS };
