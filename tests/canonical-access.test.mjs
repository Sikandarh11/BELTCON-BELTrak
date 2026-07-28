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

const [rolesModule, adminServiceModule, adminApiModule, authAccountModule, authRepositoryModule] =
  await Promise.all([
    vite.ssrLoadModule("/src/auth/canonicalRoles.ts"),
    vite.ssrLoadModule("/src/services/admin/users/adminUserService.server.ts"),
    vite.ssrLoadModule("/src/services/admin/users/adminUserApi.server.ts"),
    vite.ssrLoadModule("/src/services/authAccount.server.ts"),
    vite.ssrLoadModule("/src/services/authRepository.server.ts"),
  ]);

const {
  CANONICAL_ROLES,
  canAccessCanonicalPath,
  canonicalRoleRank,
  requireCanonicalRole,
  roleIsAtLeast,
} = rolesModule;
const { createAdminUserService } = adminServiceModule;
const { handleCreateAdminUserRequest, handleListAdminUsersRequest } = adminApiModule;
const { createAuthAccountService } = authAccountModule;
const { getSessionFromRequest } = authRepositoryModule;

const ACTOR_ID = "00000000-0000-4000-8000-000000000501";
const TARGET_ID = "00000000-0000-4000-8000-000000000502";
const NOW = "2026-07-27T20:00:00.000Z";

function authUser(id = TARGET_ID) {
  return {
    id,
    email: "target@airport.test",
    firstName: "Target",
    lastName: "User",
    createdAt: NOW,
    lastSignInAt: null,
    emailConfirmed: true,
  };
}

function profile(overrides = {}) {
  return {
    id: TARGET_ID,
    email: "target@airport.test",
    firstName: "Target",
    lastName: "User",
    role: "Operations Officer",
    status: "ACTIVE",
    isActive: true,
    mustChangePassword: false,
    createdAt: NOW,
    lastLogin: null,
    updatedAt: NOW,
    createdBy: ACTOR_ID,
    version: 1,
    ...overrides,
  };
}

function session(role, workspaceMode = "Operator") {
  return {
    token: "test-access-token",
    expiresAt: "2026-07-28T20:00:00.000Z",
    workspaceMode,
    user: {
      id: ACTOR_ID,
      firstName: "Acting",
      lastName: "Administrator",
      email: "actor@airport.test",
      role,
      status: "ACTIVE",
      isActive: true,
      mustChangePassword: false,
      createdAt: NOW,
      lastLogin: null,
    },
  };
}

function adminRepository(options = {}) {
  const storedProfile = profile(options.profile);
  const storedAuth = authUser();
  const calls = { update: [], transition: [] };

  return {
    calls,
    async listAllAuthUsers() {
      return [structuredClone(storedAuth)];
    },
    async listAllProfiles() {
      return [structuredClone(storedProfile)];
    },
    async findAuthUserById(userId) {
      return userId === TARGET_ID ? structuredClone(storedAuth) : null;
    },
    async findAuthUserByEmail() {
      return null;
    },
    async findProfileById(userId) {
      return userId === TARGET_ID ? structuredClone(storedProfile) : null;
    },
    async findProfileByEmail() {
      return null;
    },
    async countActiveSystemAdministrators() {
      return options.activeSystemAdministrators ?? 2;
    },
    async updateProfile(input) {
      calls.update.push(structuredClone(input));
      Object.assign(storedProfile, {
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        isActive: input.isActive,
        status: input.isActive ? "ACTIVE" : "DEACTIVATED",
        version: input.expectedVersion + 1,
      });
      return structuredClone(storedProfile);
    },
    async transitionStatus(input) {
      calls.transition.push(structuredClone(input));
      const status = {
        ACTIVATE: "ACTIVE",
        SUSPEND: "SUSPENDED",
        LOCK: "LOCKED",
        UNLOCK: "ACTIVE",
        DEACTIVATE: "DEACTIVATED",
      }[input.action];
      Object.assign(storedProfile, {
        status,
        isActive: status === "ACTIVE",
        version: input.expectedVersion + 1,
      });
      return structuredClone(storedProfile);
    },
    async recordAudit() {},
    async resendInvitation() {},
    async sendPasswordReset() {},
  };
}

function editInput(overrides = {}) {
  return {
    userId: TARGET_ID,
    firstName: "Target",
    lastName: "Updated",
    role: "Customs Supervisor",
    isActive: true,
    expectedVersion: 1,
    reason: "Approved canonical role update",
    actorId: ACTOR_ID,
    canonicalRole: "Airport Administrator",
    requestId: "edit-role-001",
    timestamp: NOW,
    ...overrides,
  };
}

function actionInput(action, overrides = {}) {
  return {
    userId: TARGET_ID,
    action,
    expectedVersion: 1,
    reason: "Approved account security action",
    actorId: ACTOR_ID,
    canonicalRole: "System Administrator",
    requestId: `action-${action.toLowerCase()}`,
    timestamp: NOW,
    redirectTo: "http://localhost/change-password",
    ...overrides,
  };
}

function createRequest(role, workspaceMode = "Admin") {
  const password = "StrongPassword123!";
  return {
    request: new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "New",
        lastName: "User",
        email: "new.user@airport.test",
        temporaryPassword: password,
        confirmPassword: password,
        role: "System Administrator",
        isActive: true,
      }),
    }),
    getSession: async () => session(role, workspaceMode),
  };
}

test("central role order and rank are canonical and unknown roles fail closed", () => {
  assert.deepEqual(
    [...CANONICAL_ROLES],
    [
      "Operations Officer",
      "Control Center Operator",
      "Customs Supervisor",
      "Airport Administrator",
      "System Administrator",
    ],
  );
  assert.equal(canonicalRoleRank("Operations Officer"), 0);
  assert.equal(canonicalRoleRank("System Administrator"), 4);
  assert.equal(canonicalRoleRank("Developer"), null);
  assert.equal(roleIsAtLeast("Developer", "Operations Officer"), false);
  assert.equal(roleIsAtLeast("System Administrator", "Unknown"), false);
  assert.throws(() => requireCanonicalRole("Developer", "Operations Officer"));
});

test("canonical page map denies direct admin and developer URLs to lower roles", () => {
  assert.equal(canAccessCanonicalPath("Operations Officer", "/tagging"), true);
  assert.equal(canAccessCanonicalPath("Operations Officer", "/settings/users"), false);
  assert.equal(canAccessCanonicalPath("Airport Administrator", "/settings/users"), true);
  assert.equal(canAccessCanonicalPath("Airport Administrator", "/dev/console"), false);
  assert.equal(canAccessCanonicalPath("System Administrator", "/dev/simulator"), true);
});

test("Operations Officer cannot read the Manage Users API", async () => {
  let listCalls = 0;
  const response = await handleListAdminUsersRequest(
    new Request("http://localhost/api/admin/users"),
    {
      getSession: async () => session("Operations Officer"),
      service: {
        async listUsers() {
          listCalls += 1;
        },
      },
    },
  );

  assert.equal(response.status, 403);
  assert.equal(listCalls, 0);
});

test("Developer workspace never grants System Administrator API access", async () => {
  let createCalls = 0;
  const input = createRequest("Operations Officer", "Developer");
  const response = await handleCreateAdminUserRequest(input.request, {
    getSession: input.getSession,
    service: {
      async createUser() {
        createCalls += 1;
      },
    },
  });

  assert.equal(response.status, 403);
  assert.equal(createCalls, 0);
});

test("Airport Administrator can read users but cannot create System Administrator", async () => {
  let listCalls = 0;
  const listResponse = await handleListAdminUsersRequest(
    new Request("http://localhost/api/admin/users"),
    {
      getSession: async () => session("Airport Administrator"),
      service: {
        async listUsers() {
          listCalls += 1;
          return {
            users: [],
            pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
          };
        },
      },
    },
  );
  assert.equal(listResponse.status, 200);
  assert.equal(listCalls, 1);

  const input = createRequest("Airport Administrator");
  const createResponse = await handleCreateAdminUserRequest(input.request, {
    getSession: input.getSession,
    service: {
      async createUser() {
        throw new Error("Airport Administrator reached create service");
      },
    },
  });
  assert.equal(createResponse.status, 403);
});

test("System Administrator can reach real user creation", async () => {
  const input = createRequest("System Administrator");
  let received = null;
  const response = await handleCreateAdminUserRequest(input.request, {
    getSession: input.getSession,
    service: {
      async createUser(command) {
        received = structuredClone(command);
        return {
          id: TARGET_ID,
          email: command.email,
          firstName: command.firstName,
          lastName: command.lastName,
          role: command.role,
          status: "ACTIVE",
          mustChangePassword: true,
        };
      },
    },
  });

  assert.equal(response.status, 201);
  assert.equal(received.canonicalRole, "System Administrator");
});

test("Airport Administrator edits non-privileged users but cannot assign System Administrator", async () => {
  const repository = adminRepository();
  const service = createAdminUserService(repository);
  const updated = await service.editUser(editInput());

  assert.equal(updated.role, "Customs Supervisor");
  assert.equal(repository.calls.update.length, 1);

  await assert.rejects(
    service.editUser(editInput({ role: "System Administrator" })),
    (error) => error.code === "ADMIN_USER_FORBIDDEN",
  );
  await assert.rejects(
    service.editUser(editInput({ isActive: false })),
    (error) => error.code === "ADMIN_USER_FORBIDDEN",
  );
});

test("final active System Administrator cannot be demoted or deactivated", async () => {
  const repository = adminRepository({
    profile: { role: "System Administrator" },
    activeSystemAdministrators: 1,
  });
  const service = createAdminUserService(repository);

  await assert.rejects(
    service.editUser(
      editInput({
        canonicalRole: "System Administrator",
        role: "Airport Administrator",
      }),
    ),
    (error) => error.code === "ADMIN_USER_LAST_ADMIN_CONFLICT",
  );
  await assert.rejects(
    service.performAction(actionInput("DEACTIVATE")),
    (error) => error.code === "ADMIN_USER_LAST_ADMIN_CONFLICT",
  );
  assert.equal(repository.calls.update.length, 0);
  assert.equal(repository.calls.transition.length, 0);
});

test("each server session request reloads canonical role and account status", async () => {
  const mutableProfile = {
    id: TARGET_ID,
    firstName: "Current",
    lastName: "User",
    email: "current@airport.test",
    role: "Operations Officer",
    status: "ACTIVE",
    isActive: true,
    mustChangePassword: false,
    createdAt: NOW,
    lastLogin: null,
  };
  const accountService = createAuthAccountService({
    async findProfileByUserId() {
      return structuredClone(mutableProfile);
    },
  });
  const request = new Request("http://localhost/api/auth/session", {
    headers: { cookie: "etb_auth_token=test-token" },
  });
  const options = {
    accountService,
    getUser: async () => ({ id: TARGET_ID, email: mutableProfile.email }),
  };

  const first = await getSessionFromRequest(request, options);
  assert.equal(first.user.role, "Operations Officer");

  mutableProfile.role = "Customs Supervisor";
  const next = await getSessionFromRequest(request, options);
  assert.equal(next.user.role, "Customs Supervisor");

  mutableProfile.status = "SUSPENDED";
  mutableProfile.isActive = false;
  assert.equal(await getSessionFromRequest(request, options), null);

  mutableProfile.status = "DEACTIVATED";
  assert.equal(await getSessionFromRequest(request, options), null);
});

test("database migration serializes and audits privileged lifecycle changes", async () => {
  const migration = await readFile(
    path.join(repositoryRoot, "supabase/migrations/014_create_admin_user_lifecycle.sql"),
    "utf8",
  );

  assert.match(migration, /PG_ADVISORY_XACT_LOCK/i);
  assert.match(migration, /final active System Administrator cannot be demoted or deactivated/i);
  assert.match(migration, /protect_final_system_administrator_delete/i);
  assert.match(migration, /'USER_ROLE_CHANGED'/);
  assert.match(migration, /'USER_ACTIVATED'/);
  assert.match(migration, /'USER_SUSPENDED'/);
  assert.match(migration, /'USER_LOCKED'/);
  assert.match(migration, /'USER_UNLOCKED'/);
  assert.match(migration, /'USER_DEACTIVATED'/);
  assert.match(migration, /'SESSION_REVOKED'/);
  assert.match(migration, /'beforeRole'/);
  assert.match(migration, /'afterStatus'/);
});

test("workspace code contains no universal access override", async () => {
  const sources = await Promise.all(
    [
      "src/auth/appRoles.ts",
      "src/components/RoleGate.tsx",
      "src/components/AppLayout.tsx",
      "src/features/developer/DeveloperPanels.tsx",
      "src/routes/supervisor.overview.tsx",
    ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );
  const combined = sources.join("\n");

  assert.doesNotMatch(combined, /hasUniversalWorkspaceAccess/);
  assert.doesNotMatch(combined, /allowWorkspaceOverride/);
  assert.doesNotMatch(combined, /workspaceMode\s*===\s*["']Developer["']\s*\|\|/);
  assert.match(sources[2], /permission:\s*"developer\.access"/);
  assert.match(sources[2], /hasPermission\(currentUser\?\.permissions/);
});
