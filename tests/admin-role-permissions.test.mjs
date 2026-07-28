import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  resolve: {
    alias: {
      "@": path.join(repositoryRoot, "src"),
    },
  },
});

test.after(async () => {
  await vite.close();
});

const [{ createRoleService }, { RolePermissionError }, apiModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/admin/roles/roleService.server.ts"),
  vite.ssrLoadModule("/src/services/admin/roles/roleErrors.ts"),
  vite.ssrLoadModule("/src/services/admin/roles/roleApi.server.ts"),
]);

const { handleGetRolePermissionsRequest, handleUpdateRolePermissionsRequest } = apiModule;

const IDS = {
  actor: "00000000-0000-4000-8000-000000000001",
  operations: "00000000-0000-4000-8000-000000000101",
  airport: "00000000-0000-4000-8000-000000000104",
  system: "00000000-0000-4000-8000-000000000105",
};

const NOW = "2026-07-27T18:00:00.000Z";

function role(id, code, name, permissionCodes, overrides = {}) {
  return {
    id,
    code,
    name,
    description: `${name} description`,
    isSystem: true,
    isActive: true,
    version: 1,
    permissionCodes,
    ...overrides,
  };
}

function permission(code) {
  return {
    id: `10000000-0000-4000-8000-${String(permission.index++).padStart(12, "0")}`,
    code,
    name: code,
    description: `${code} description`,
    category: "Test",
    riskLevel: "MEDIUM",
  };
}
permission.index = 1;

const permissionCodes = [
  "dashboard.view",
  "alarm.acknowledge",
  "alarm.escalate",
  "alarm.close",
  "bag.manage",
  "bag.tag",
  "bag.recheck",
  "reader.view",
  "reader.manage",
  "report.view",
  "user.view",
  "user.manage",
  "role.view",
  "role.manage",
  "settings.manage",
  "audit.view",
  "developer.access",
  "xray.view",
  "xray.refresh",
];

function snapshot() {
  permission.index = 1;
  return {
    roles: [
      role(IDS.operations, "operations_officer", "Operations Officer", [
        "dashboard.view",
        "bag.tag",
      ]),
      role(IDS.airport, "airport_administrator", "Airport Administrator", [
        "dashboard.view",
        "user.view",
        "role.view",
      ]),
      role(IDS.system, "system_administrator", "System Administrator", permissionCodes),
    ],
    permissions: permissionCodes.map(permission),
  };
}

function makeRepository(options = {}) {
  const data = structuredClone(options.snapshot ?? snapshot());
  const audits = [];
  let updateCalls = 0;

  return {
    state: {
      data,
      audits,
      get updateCalls() {
        return updateCalls;
      },
    },

    async getRolesWithPermissions() {
      return structuredClone(data);
    },

    async updateRolePermissions(input) {
      updateCalls += 1;
      if (options.updateFailure) {
        throw new RolePermissionError(
          "Database transaction rolled back",
          "ROLE_PERMISSION_PERSISTENCE_ERROR",
          500,
        );
      }

      const target = data.roles.find((candidate) => candidate.id === input.roleId);
      if (!target) {
        throw new RolePermissionError("Role was not found", "ROLE_PERMISSION_NOT_FOUND", 404);
      }
      if (target.version !== input.expectedVersion) {
        throw new RolePermissionError(
          "This role was changed by another administrator",
          "ROLE_PERMISSION_VERSION_CONFLICT",
          409,
        );
      }

      const beforePermissionCodes = [...target.permissionCodes];
      target.permissionCodes = [...input.permissionCodes];
      target.version += 1;
      audits.push({
        action: "ROLE_PERMISSIONS_UPDATED",
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        roleId: input.roleId,
        beforePermissionCodes,
        afterPermissionCodes: [...input.permissionCodes],
        reason: input.reason,
        version: target.version,
        requestId: input.requestId,
        timestamp: input.timestamp,
      });
      return {
        roleId: target.id,
        roleCode: target.code,
        version: target.version,
        beforePermissionCodes,
        afterPermissionCodes: [...target.permissionCodes],
      };
    },

    async recordUpdateFailure(input) {
      audits.push({ action: "ROLE_PERMISSION_UPDATE_FAILED", ...structuredClone(input) });
    },
  };
}

function session(roleName) {
  return {
    token: "server-test-token",
    expiresAt: "2026-07-27T19:00:00.000Z",
    user: {
      id: IDS.actor,
      email: "admin@airport.test",
      firstName: "Test",
      lastName: "Administrator",
      role: roleName,
      status: "ACTIVE",
      isActive: true,
      mustChangePassword: false,
      createdAt: NOW,
      lastLogin: NOW,
    },
  };
}

async function allowPermission(currentSession, permissionCode) {
  return {
    canonicalRole: currentSession.user.role,
    permissions: [permissionCode],
    authorizationVersion: 1,
  };
}

function updateInput(overrides = {}) {
  return {
    roleId: IDS.operations,
    permissionCodes: ["dashboard.view", "bag.tag", "report.view"],
    expectedVersion: 1,
    reason: "Approved operational access update",
    actorId: IDS.actor,
    canonicalRole: "System Administrator",
    requestId: "role-update-001",
    timestamp: NOW,
    ...overrides,
  };
}

function updateRequest(roleId = IDS.operations, body = {}) {
  return new Request(`http://localhost/api/admin/roles/${roleId}/permissions`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      permissionCodes: ["dashboard.view", "bag.tag", "report.view"],
      expectedVersion: 1,
      reason: "Approved operational access update",
      ...body,
    }),
  });
}

test("role matrix loads through the server service for Airport Administrator or higher", async () => {
  const repository = makeRepository();
  const matrix =
    await createRoleService(repository).getRolesWithPermissions("Airport Administrator");

  assert.equal(matrix.roles.length, 3);
  assert.equal(matrix.permissions.length, permissionCodes.length);
  assert.deepEqual(matrix.roles[0].permissionCodes, ["dashboard.view", "bag.tag"]);

  const response = await handleGetRolePermissionsRequest(
    new Request("http://localhost/api/admin/roles/permissions"),
    {
      getSession: async () => session("Airport Administrator"),
      service: createRoleService(repository),
      requirePermission: allowPermission,
    },
  );
  assert.equal(response.status, 200);
});

test("permission update persists and a refresh returns saved values", async () => {
  const repository = makeRepository();
  const service = createRoleService(repository);

  const update = await service.updateRolePermissions(updateInput());
  const refreshed = await service.getRolesWithPermissions("System Administrator");
  const operations = refreshed.roles.find((candidate) => candidate.id === IDS.operations);

  assert.equal(update.version, 2);
  assert.deepEqual(operations.permissionCodes, ["dashboard.view", "bag.tag", "report.view"]);
  assert.equal(operations.version, 2);
});

test("Operations Officer and Airport Administrator cannot update permissions", async () => {
  for (const canonicalRole of ["Operations Officer", "Airport Administrator"]) {
    const repository = makeRepository();
    const response = await handleUpdateRolePermissionsRequest(updateRequest(), IDS.operations, {
      getSession: async () => session(canonicalRole),
      service: createRoleService(repository),
    });

    assert.equal(response.status, 403);
    assert.equal(repository.state.updateCalls, 0);
  }
});

test("System Administrator can update permissions through the API", async () => {
  const repository = makeRepository();
  const response = await handleUpdateRolePermissionsRequest(updateRequest(), IDS.operations, {
    getSession: async () => session("System Administrator"),
    service: createRoleService(repository),
    requirePermission: allowPermission,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.update.version, 2);
  assert.equal(repository.state.updateCalls, 1);
});

test("unknown permission is rejected and audited without changing the role", async () => {
  const repository = makeRepository();
  const before = structuredClone(repository.state.data.roles[0]);

  await assert.rejects(
    createRoleService(repository).updateRolePermissions(
      updateInput({ permissionCodes: ["dashboard.view", "unknown.permission"] }),
    ),
    (error) => error.code === "ROLE_PERMISSION_UNKNOWN_PERMISSION",
  );

  assert.deepEqual(repository.state.data.roles[0], before);
  assert.equal(repository.state.updateCalls, 0);
  assert.equal(repository.state.audits.at(-1).action, "ROLE_PERMISSION_UPDATE_FAILED");
});

test("optimistic version conflict is rejected and audited", async () => {
  const repository = makeRepository();

  await assert.rejects(
    createRoleService(repository).updateRolePermissions(updateInput({ expectedVersion: 99 })),
    (error) => error.code === "ROLE_PERMISSION_VERSION_CONFLICT",
  );

  assert.equal(repository.state.updateCalls, 0);
  assert.equal(repository.state.audits.at(-1).errorCode, "ROLE_PERMISSION_VERSION_CONFLICT");
});

test("transaction failure rolls back the matrix and records a failure audit", async () => {
  const repository = makeRepository({ updateFailure: true });
  const before = structuredClone(repository.state.data);

  await assert.rejects(
    createRoleService(repository).updateRolePermissions(updateInput()),
    (error) => error.code === "ROLE_PERMISSION_PERSISTENCE_ERROR",
  );

  assert.deepEqual(repository.state.data, before);
  assert.equal(repository.state.audits.at(-1).action, "ROLE_PERMISSION_UPDATE_FAILED");
});

test("System Administrator critical permissions cannot be removed", async () => {
  const repository = makeRepository();
  const systemRole = repository.state.data.roles.find((candidate) => candidate.id === IDS.system);

  await assert.rejects(
    createRoleService(repository).updateRolePermissions(
      updateInput({
        roleId: IDS.system,
        permissionCodes: permissionCodes.filter((code) => code !== "role.manage"),
      }),
    ),
    (error) => error.code === "ROLE_PERMISSION_LOCKOUT_RISK",
  );

  assert.ok(systemRole.permissionCodes.includes("role.manage"));
  assert.equal(repository.state.updateCalls, 0);
  assert.equal(repository.state.audits.at(-1).action, "ROLE_PERMISSION_UPDATE_FAILED");
});

test("successful update writes the durable aggregate audit event", async () => {
  const repository = makeRepository();
  await createRoleService(repository).updateRolePermissions(updateInput());

  const audit = repository.state.audits.find(
    (candidate) => candidate.action === "ROLE_PERMISSIONS_UPDATED",
  );
  assert.equal(audit.actorId, IDS.actor);
  assert.equal(audit.canonicalRole, "System Administrator");
  assert.equal(audit.roleId, IDS.operations);
  assert.equal(audit.reason, updateInput().reason);
  assert.equal(audit.version, 2);
  assert.equal(audit.requestId, "role-update-001");
});

test("migration and UI enforce transactional persistence without a fake success path", async () => {
  const [migration, repositorySource, routeSource, clientSource] = await Promise.all(
    [
      "supabase/migrations/015_create_role_permissions.sql",
      "src/services/admin/roles/roleRepository.server.ts",
      "src/routes/settings.roles.tsx",
      "src/services/admin/roles/roleClient.ts",
    ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.roles/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.permissions/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.role_permissions/i);
  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /version = v_next_version/i);
  assert.match(migration, /ROLE_PERMISSIONS_UPDATED/);
  assert.match(migration, /ROLE_PERMISSION_GRANTED/);
  assert.match(migration, /ROLE_PERMISSION_REVOKED/);
  assert.match(migration, /Critical administrator permissions must be retained/i);
  assert.match(migration, /TO service_role/i);
  assert.match(repositorySource, /\.rpc\("update_role_permissions_v1"/);
  assert.match(repositorySource, /ROLE_PERMISSION_UPDATE_FAILED/);
  assert.match(routeSource, /getRolesWithPermissions/);
  assert.match(routeSource, /await updateRolePermissions/);
  assert.match(routeSource, /onSuccess:[\s\S]*toast\.success/);
  assert.doesNotMatch(routeSource, /@\/mocks\/seed/);
  assert.doesNotMatch(routeSource, /function handleSave\(\)\s*\{\s*toast\.success/);
  assert.match(clientSource, /if \(!response\.ok\) throw/);
});
