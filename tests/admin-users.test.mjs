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

const [{ createAdminUserService }, apiModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/admin/users/adminUserService.server.ts"),
  vite.ssrLoadModule("/src/services/admin/users/adminUserApi.server.ts"),
]);

const { handleListAdminUsersRequest, handleRepairAdminProfileRequest } = apiModule;

const IDS = {
  complete: "00000000-0000-4000-8000-000000000001",
  missingProfile: "00000000-0000-4000-8000-000000000002",
  missingAuth: "00000000-0000-4000-8000-000000000003",
  mismatch: "00000000-0000-4000-8000-000000000004",
};

function authUser(id, overrides = {}) {
  return {
    id,
    email: `${id.slice(-4)}@airport.test`,
    firstName: "Auth",
    lastName: id.slice(-4),
    createdAt: "2026-07-27T08:00:00.000Z",
    lastSignInAt: "2026-07-27T09:00:00.000Z",
    emailConfirmed: true,
    ...overrides,
  };
}

function profile(id, overrides = {}) {
  return {
    id,
    email: `${id.slice(-4)}@airport.test`,
    firstName: "Profile",
    lastName: id.slice(-4),
    role: "Operations Officer",
    status: "ACTIVE",
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-07-27T08:00:00.000Z",
    lastLogin: "2026-07-27T08:30:00.000Z",
    updatedAt: "2026-07-27T08:30:00.000Z",
    createdBy: null,
    version: 1,
    ...overrides,
  };
}

function repositoryWith(authUsers, profiles) {
  return {
    async listAllAuthUsers() {
      return structuredClone(authUsers);
    },
    async listAllProfiles() {
      return structuredClone(profiles);
    },
    async findAuthUserById(userId) {
      return structuredClone(authUsers.find((user) => user.id === userId) ?? null);
    },
    async repairProfile() {
      throw new Error("Unexpected profile repair");
    },
  };
}

function defaultFilters(overrides = {}) {
  return {
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

function systemAdministratorSession() {
  return {
    token: "server-session-token",
    expiresAt: "2026-07-27T12:00:00.000Z",
    user: {
      id: "00000000-0000-4000-8000-000000000099",
      firstName: "System",
      lastName: "Administrator",
      email: "system.admin@airport.test",
      role: "System Administrator",
      createdAt: "2026-07-27T07:00:00.000Z",
      lastLogin: null,
    },
  };
}

test("admin user reconciliation returns every required sync status", async () => {
  const repository = repositoryWith(
    [
      authUser(IDS.complete, {
        email: "adeel.khan@airport.test",
        firstName: "Auth Adeel",
      }),
      authUser(IDS.missingProfile, {
        email: "missing.profile@airport.test",
        firstName: "Missing",
        lastName: "Profile",
      }),
      authUser(IDS.mismatch, {
        email: "authoritative.email@airport.test",
      }),
    ],
    [
      profile(IDS.complete, {
        email: "Adeel.Khan@airport.test",
        firstName: "Adeel",
        lastName: "Khan",
        role: "System Administrator",
      }),
      profile(IDS.missingAuth, {
        email: "missing.auth@airport.test",
        firstName: "Missing",
        lastName: "Auth",
      }),
      profile(IDS.mismatch, {
        email: "stale.profile@airport.test",
      }),
    ],
  );
  const page = await createAdminUserService(repository).listUsers(defaultFilters());
  const usersById = new Map(page.users.map((user) => [user.id, user]));

  assert.equal(usersById.get(IDS.complete).syncStatus, "COMPLETE");
  assert.equal(usersById.get(IDS.complete).email, "adeel.khan@airport.test");
  assert.equal(usersById.get(IDS.complete).firstName, "Adeel");
  assert.equal(usersById.get(IDS.missingProfile).syncStatus, "MISSING_PROFILE");
  assert.equal(usersById.get(IDS.missingProfile).role, null);
  assert.equal(usersById.get(IDS.missingAuth).syncStatus, "MISSING_AUTH_USER");
  assert.equal(usersById.get(IDS.missingAuth).emailConfirmed, null);
  assert.equal(usersById.get(IDS.mismatch).syncStatus, "EMAIL_MISMATCH");
  assert.equal(usersById.get(IDS.mismatch).email, "authoritative.email@airport.test");
  assert.equal(page.pagination.total, 4);
});

test("repairing a missing profile keeps the Auth UUID and authoritative email", async () => {
  const authIdentity = authUser(IDS.missingProfile, {
    email: "auth.authoritative@airport.test",
  });
  let repairCommand = null;
  const repository = {
    ...repositoryWith([authIdentity], []),
    async repairProfile(command) {
      repairCommand = structuredClone(command);
      return profile(command.userId, {
        email: authIdentity.email,
        firstName: command.firstName,
        lastName: command.lastName,
        role: command.role,
      });
    },
  };

  const repaired = await createAdminUserService(repository).repairProfile({
    userId: IDS.missingProfile,
    firstName: "  Adeel ",
    lastName: " Khan  ",
    role: "Operations Officer",
    actorId: systemAdministratorSession().user.id,
    canonicalRole: "System Administrator",
    requestId: "repair-test-001",
    reason: "Restore the missing BELTrak profile",
    timestamp: "2026-07-27T10:00:00.000Z",
  });

  assert.equal(repairCommand.userId, IDS.missingProfile);
  assert.equal(repairCommand.firstName, "Adeel");
  assert.equal(repairCommand.lastName, "Khan");
  assert.equal(repairCommand.role, "Operations Officer");
  assert.equal(repaired.id, IDS.missingProfile);
  assert.equal(repaired.email, "auth.authoritative@airport.test");
  assert.equal(repaired.syncStatus, "COMPLETE");
});

test("profile repair rejects a non-System-Administrator before invoking the service", async () => {
  let repairCalls = 0;
  const response = await handleRepairAdminProfileRequest(
    new Request(`http://localhost/api/admin/users/${IDS.missingProfile}/repair-profile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Adeel",
        lastName: "Khan",
        role: "Operations Officer",
      }),
    }),
    IDS.missingProfile,
    {
      getSession: async () => ({
        ...systemAdministratorSession(),
        user: {
          ...systemAdministratorSession().user,
          role: "Operations Officer",
        },
      }),
      service: {
        async listUsers() {
          throw new Error("Unexpected list");
        },
        async repairProfile() {
          repairCalls += 1;
          throw new Error("Unauthorized service call");
        },
      },
    },
  );

  assert.equal(response.status, 403);
  assert.equal(repairCalls, 0);
  assert.match(
    await response.text(),
    /Canonical System Administrator role(?: or higher)? is required/,
  );
});

test("admin user list allows canonical Airport Administrator or higher", async () => {
  let listCalls = 0;
  const response = await handleListAdminUsersRequest(
    new Request("http://localhost/api/admin/users"),
    {
      getSession: async () => ({
        ...systemAdministratorSession(),
        user: {
          ...systemAdministratorSession().user,
          role: "Airport Administrator",
        },
      }),
      service: {
        async listUsers() {
          listCalls += 1;
          return {
            users: [],
            pagination: {
              page: 1,
              pageSize: 25,
              total: 0,
              totalPages: 0,
            },
          };
        },
        async repairProfile() {
          throw new Error("Unexpected repair");
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(listCalls, 1);
});

test("admin user search, filters, and stable pagination operate on reconciled users", async () => {
  const authUsers = [
    authUser("00000000-0000-4000-8000-000000000011", {
      email: "zara.security@airport.test",
    }),
    authUser("00000000-0000-4000-8000-000000000012", {
      email: "adeel.khan@airport.test",
    }),
    authUser("00000000-0000-4000-8000-000000000013", {
      email: "reem.ops@airport.test",
    }),
    authUser("00000000-0000-4000-8000-000000000014", {
      email: "omar.admin@airport.test",
    }),
  ];
  const profiles = [
    profile(authUsers[0].id, {
      firstName: "Zara",
      lastName: "Security",
      role: "Customs Supervisor",
    }),
    profile(authUsers[1].id, {
      firstName: "Adeel",
      lastName: "Khan",
      role: "Operations Officer",
    }),
    profile(authUsers[2].id, {
      firstName: "Reem",
      lastName: "Operations",
      role: "Operations Officer",
      isActive: false,
    }),
    profile(authUsers[3].id, {
      firstName: "Omar",
      lastName: "Administrator",
      role: "System Administrator",
    }),
  ];
  const service = createAdminUserService(repositoryWith(authUsers, profiles));

  const searchResult = await service.listUsers(
    defaultFilters({ search: "adeel.khan", pageSize: 2 }),
  );
  assert.deepEqual(
    searchResult.users.map((user) => user.email),
    ["adeel.khan@airport.test"],
  );

  const activeOperators = await service.listUsers(
    defaultFilters({
      role: "Operations Officer",
      isActive: true,
    }),
  );
  assert.deepEqual(
    activeOperators.users.map((user) => user.firstName),
    ["Adeel"],
  );

  const firstPage = await service.listUsers(defaultFilters({ page: 1, pageSize: 2 }));
  const secondPage = await service.listUsers(defaultFilters({ page: 2, pageSize: 2 }));
  assert.equal(firstPage.pagination.total, 4);
  assert.equal(firstPage.pagination.totalPages, 2);
  assert.equal(firstPage.users.length, 2);
  assert.equal(secondPage.users.length, 2);
  assert.deepEqual(
    [...firstPage.users, ...secondPage.users].map((user) => user.lastName),
    ["Administrator", "Khan", "Operations", "Security"],
  );
});

test("profile repair migration is atomic and writes the durable audit event", async () => {
  const migration = await readFile(
    path.join(repositoryRoot, "supabase", "migrations", "011_create_admin_user_profile_repair.sql"),
    "utf8",
  );

  assert.match(migration, /FROM auth\.users/i);
  assert.match(migration, /ON CONFLICT \(id\) DO UPDATE/i);
  assert.match(migration, /BTRIM\(v_auth_email\)/i);
  assert.match(migration, /'USER_PROFILE_REPAIRED'/);
  assert.match(migration, /INSERT INTO public\.audit_events/i);
  assert.match(migration, /TO service_role/i);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/i);
});

test("browser user-management code contains no service-role credential or server import", async () => {
  const browserFiles = await Promise.all(
    [
      "src/routes/settings.users.tsx",
      "src/services/admin/users/adminUserClient.ts",
      "src/services/admin/users/adminUserTypes.ts",
    ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );
  const browserSource = browserFiles.join("\n");

  assert.doesNotMatch(browserSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(browserSource, /serviceRoleKey/);
  assert.doesNotMatch(browserSource, /adminUserRepository\.server/);
  assert.doesNotMatch(browserSource, /adminUserService\.server/);
  assert.doesNotMatch(browserSource, /adminUserApi\.server/);
});

test("Manage Users no longer imports or renders mock Zustand users", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "src", "routes", "settings.users.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /useAppStore/);
  assert.doesNotMatch(source, /@\/mocks\/seed/);
  assert.doesNotMatch(source, /\bUSERS\b/);
  assert.match(source, /listAdminUsers/);
  assert.match(source, /MISSING_PROFILE/);
});
