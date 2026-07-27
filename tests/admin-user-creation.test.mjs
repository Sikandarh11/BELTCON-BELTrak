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

const [serviceModule, apiModule, schemasModule, errorsModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/admin/users/adminUserService.server.ts"),
  vite.ssrLoadModule("/src/services/admin/users/adminUserApi.server.ts"),
  vite.ssrLoadModule("/src/services/admin/users/adminUserSchemas.ts"),
  vite.ssrLoadModule("/src/services/admin/users/adminUserErrors.ts"),
]);

const { createAdminUserService } = serviceModule;
const { handleCreateAdminUserRequest } = apiModule;
const { createAdminUserSchema } = schemasModule;
const { AdminUserError } = errorsModule;

const ACTOR_ID = "00000000-0000-4000-8000-000000000099";
const CREATED_ID = "00000000-0000-4000-8000-000000000101";
const CREATED_AT = "2026-07-27T14:00:00.000Z";
const STRONG_PASSWORD = "StrongPassword123!";

function systemAdministratorSession(overrides = {}) {
  return {
    token: "server-session-token",
    expiresAt: "2026-07-27T18:00:00.000Z",
    workspaceMode: "Admin",
    user: {
      id: ACTOR_ID,
      firstName: "System",
      lastName: "Administrator",
      email: "system.admin@airport.test",
      role: "System Administrator",
      createdAt: "2026-07-27T07:00:00.000Z",
      lastLogin: null,
      ...overrides,
    },
  };
}

function validRequest(overrides = {}) {
  return {
    firstName: "Adeel",
    lastName: "Khan",
    email: "ADEEL@BELTCON.DE",
    temporaryPassword: STRONG_PASSWORD,
    confirmPassword: STRONG_PASSWORD,
    role: "Operations Officer",
    isActive: true,
    ...overrides,
  };
}

function createRequest(body = validRequest()) {
  return new Request("http://localhost/api/admin/users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "create-user-test-001",
    },
    body: JSON.stringify(body),
  });
}

function makeRepository(options = {}) {
  const authUsers = structuredClone(options.authUsers ?? []);
  const profiles = structuredClone(options.profiles ?? []);
  const audits = [];
  const credentials = new Map();
  const calls = {
    createAuth: [],
    createProfile: [],
    deleteAuth: [],
  };

  return {
    state: { authUsers, profiles, audits, credentials, calls },

    async listAllAuthUsers() {
      return structuredClone(authUsers);
    },

    async listAllProfiles() {
      return structuredClone(profiles);
    },

    async findAuthUserById(userId) {
      return structuredClone(authUsers.find((user) => user.id === userId) ?? null);
    },

    async findProfileByEmail(email) {
      return structuredClone(
        profiles.find((profile) => profile.email.toLowerCase() === email.toLowerCase()) ?? null,
      );
    },

    async createAuthUser(input) {
      calls.createAuth.push(structuredClone(input));
      if (authUsers.some((user) => user.email?.toLowerCase() === input.email.toLowerCase())) {
        throw new AdminUserError(
          "An account with this email already exists.",
          "ADMIN_USER_DUPLICATE",
          409,
        );
      }
      if (options.authFailure) {
        throw new AdminUserError(
          "Unable to create the Supabase Auth account",
          "ADMIN_USER_AUTH_CREATION_ERROR",
          502,
        );
      }

      const user = {
        id: CREATED_ID,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        createdAt: CREATED_AT,
        lastSignInAt: null,
        emailConfirmed: true,
      };
      authUsers.push(user);
      credentials.set(input.email, input.temporaryPassword);
      return structuredClone(user);
    },

    async createProfile(input) {
      calls.createProfile.push(structuredClone(input));
      if (options.profileFailure) {
        throw new AdminUserError(
          "Unable to create the BELTrak profile",
          "ADMIN_USER_PERSISTENCE_ERROR",
          500,
        );
      }

      const authUser = authUsers.find((user) => user.id === input.userId);
      if (!authUser) throw new Error("Auth identity is required before the profile");
      const profile = {
        id: input.userId,
        email: authUser.email,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        status: input.isActive ? "ACTIVE" : "PENDING",
        isActive: input.isActive,
        mustChangePassword: true,
        createdAt: input.timestamp,
        lastLogin: null,
        updatedAt: input.timestamp,
        createdBy: input.actorId,
        version: 1,
      };
      profiles.push(profile);
      audits.push({
        action: "USER_PROFILE_CREATED",
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        targetUserId: input.userId,
        targetEmail: authUser.email,
        assignedRole: input.role,
        outcome: "SUCCESS",
        requestId: input.requestId,
        timestamp: input.timestamp,
      });
      audits.push({
        action: "USER_CREATED",
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        targetUserId: input.userId,
        targetEmail: authUser.email,
        assignedRole: input.role,
        outcome: "SUCCESS",
        requestId: input.requestId,
        timestamp: input.timestamp,
      });
      return structuredClone(profile);
    },

    async deleteAuthUser(userId) {
      calls.deleteAuth.push(userId);
      if (options.compensationFailure) {
        throw new Error("Simulated Auth cleanup failure");
      }
      const index = authUsers.findIndex((user) => user.id === userId);
      if (index >= 0) {
        const [removed] = authUsers.splice(index, 1);
        credentials.delete(removed.email);
      }
    },

    async recordAudit(input) {
      audits.push(structuredClone(input));
    },

    async repairProfile() {
      throw new Error("Unexpected profile repair");
    },

    async authenticate(email, password) {
      return credentials.get(email.toLowerCase()) === password;
    },
  };
}

function serviceInput(overrides = {}) {
  return {
    ...validRequest(),
    email: "adeel@beltcon.de",
    actorId: ACTOR_ID,
    canonicalRole: "System Administrator",
    requestId: "create-user-service-001",
    timestamp: CREATED_AT,
    ...overrides,
  };
}

test("System Administrator creates matching Auth and profile identities", async () => {
  const repository = makeRepository();
  const service = createAdminUserService(repository);
  const response = await handleCreateAdminUserRequest(createRequest(), {
    getSession: async () => systemAdministratorSession(),
    service,
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.user.id, CREATED_ID);
  assert.equal(body.user.email, "adeel@beltcon.de");
  assert.equal(body.user.role, "Operations Officer");
  assert.equal(body.user.status, "ACTIVE");
  assert.equal(body.user.mustChangePassword, true);
  assert.equal(repository.state.authUsers[0].id, repository.state.profiles[0].id);
  assert.equal(repository.state.profiles[0].role, "Operations Officer");
  assert.equal(repository.state.profiles[0].createdBy, ACTOR_ID);
  assert.deepEqual(
    repository.state.audits.map((event) => event.action),
    ["USER_CREATION_REQUESTED", "AUTH_USER_CREATED", "USER_PROFILE_CREATED", "USER_CREATED"],
  );
  assert.ok(
    repository.state.audits.every(
      (event) =>
        event.actorId === ACTOR_ID &&
        event.canonicalRole === "System Administrator" &&
        event.targetEmail === "adeel@beltcon.de" &&
        event.assignedRole === "Operations Officer" &&
        event.requestId,
    ),
  );
});

test("canonical Operations Officer is rejected before user creation", async () => {
  const repository = makeRepository();
  const response = await handleCreateAdminUserRequest(createRequest(), {
    getSession: async () => systemAdministratorSession({ role: "Operations Officer" }),
    service: createAdminUserService(repository),
  });

  assert.equal(response.status, 403);
  assert.equal(repository.state.calls.createAuth.length, 0);
});

test("Developer workspace does not authorize a non-admin canonical user", async () => {
  const repository = makeRepository();
  const response = await handleCreateAdminUserRequest(createRequest(), {
    getSession: async () => ({
      ...systemAdministratorSession({ role: "Operations Officer" }),
      workspaceMode: "Developer",
    }),
    service: createAdminUserService(repository),
  });

  assert.equal(response.status, 403);
  assert.equal(repository.state.calls.createAuth.length, 0);
});

test("temporary password stays out of profile, response, and audit records", async () => {
  const repository = makeRepository();
  const user = await createAdminUserService(repository).createUser(serviceInput());
  const serializedSafeState = JSON.stringify({
    user,
    profiles: repository.state.profiles,
    audits: repository.state.audits,
  });

  assert.equal("temporaryPassword" in user, false);
  assert.equal("temporaryPassword" in repository.state.profiles[0], false);
  assert.equal(serializedSafeState.includes(STRONG_PASSWORD), false);
  assert.equal(serializedSafeState.includes("temporaryPassword"), false);
});

test("temporary password validates every required strength rule without echoing it", () => {
  const cases = [
    ["Short1!", /at least 12/],
    ["lowercasepassword1!", /uppercase/],
    ["UPPERCASEPASSWORD1!", /lowercase/],
    ["PasswordWithoutNumber!", /number/],
    ["PasswordWithoutSpecial1", /special/],
  ];

  for (const [password, expectedMessage] of cases) {
    const parsed = createAdminUserSchema.safeParse(
      validRequest({ temporaryPassword: password, confirmPassword: password }),
    );
    assert.equal(parsed.success, false);
    const message = parsed.error.issues[0].message;
    assert.match(message, expectedMessage);
    assert.equal(message.includes(password), false);
  }

  const mismatch = createAdminUserSchema.safeParse(
    validRequest({ confirmPassword: "DifferentPassword123!" }),
  );
  assert.equal(mismatch.success, false);
  assert.match(mismatch.error.issues[0].message, /must match/);
  assert.equal(mismatch.error.issues[0].message.includes(STRONG_PASSWORD), false);
});

test("inactive creation produces a consistent PENDING profile", async () => {
  const repository = makeRepository();
  const user = await createAdminUserService(repository).createUser(
    serviceInput({ isActive: false }),
  );

  assert.equal(user.status, "PENDING");
  assert.equal(repository.state.profiles[0].status, "PENDING");
  assert.equal(repository.state.profiles[0].isActive, false);
  assert.equal(repository.state.profiles[0].mustChangePassword, true);
});

test("Auth creation failure creates no profile and returns a safe error", async () => {
  const repository = makeRepository({ authFailure: true });

  await assert.rejects(
    createAdminUserService(repository).createUser(serviceInput()),
    (error) =>
      error.code === "ADMIN_USER_AUTH_CREATION_ERROR" &&
      /Unable to create the Supabase Auth account/.test(error.message),
  );

  assert.equal(repository.state.authUsers.length, 0);
  assert.equal(repository.state.profiles.length, 0);
  assert.equal(repository.state.calls.createProfile.length, 0);
  assert.ok(
    repository.state.audits.some(
      (event) =>
        event.action === "USER_CREATION_FAILED" &&
        event.outcome === "FAILURE" &&
        event.errorCode === "ADMIN_USER_AUTH_CREATION_ERROR",
    ),
  );
});

test("duplicate profile or Auth email returns the same safe conflict", async () => {
  const existingProfileRepository = makeRepository({
    profiles: [
      {
        id: "00000000-0000-4000-8000-000000000202",
        email: "adeel@beltcon.de",
        firstName: "Existing",
        lastName: "Profile",
        role: "Operations Officer",
        status: "ACTIVE",
        isActive: true,
        mustChangePassword: false,
        createdAt: CREATED_AT,
        lastLogin: null,
        updatedAt: CREATED_AT,
        createdBy: ACTOR_ID,
        version: 1,
      },
    ],
  });
  const profileResponse = await handleCreateAdminUserRequest(createRequest(), {
    getSession: async () => systemAdministratorSession(),
    service: createAdminUserService(existingProfileRepository),
  });

  assert.equal(profileResponse.status, 409);
  assert.deepEqual(await profileResponse.json(), {
    error: "An account with this email already exists.",
    code: "ADMIN_USER_DUPLICATE",
  });

  const existingAuthRepository = makeRepository({
    authUsers: [
      {
        id: "00000000-0000-4000-8000-000000000203",
        email: "adeel@beltcon.de",
        firstName: "Existing",
        lastName: "Auth",
        createdAt: CREATED_AT,
        lastSignInAt: null,
        emailConfirmed: true,
      },
    ],
  });
  const authResponse = await handleCreateAdminUserRequest(createRequest(), {
    getSession: async () => systemAdministratorSession(),
    service: createAdminUserService(existingAuthRepository),
  });

  assert.equal(authResponse.status, 409);
  assert.deepEqual(await authResponse.json(), {
    error: "An account with this email already exists.",
    code: "ADMIN_USER_DUPLICATE",
  });
});

test("profile failure deletes the newly created Auth identity before returning failure", async () => {
  const repository = makeRepository({ profileFailure: true });

  await assert.rejects(
    createAdminUserService(repository).createUser(serviceInput()),
    (error) =>
      error.code === "ADMIN_USER_PERSISTENCE_ERROR" &&
      /incomplete Auth account was removed/.test(error.message),
  );

  assert.deepEqual(repository.state.calls.deleteAuth, [CREATED_ID]);
  assert.equal(repository.state.authUsers.length, 0);
  assert.equal(repository.state.profiles.length, 0);
  assert.ok(
    repository.state.audits.some(
      (event) =>
        event.action === "USER_CREATION_FAILED" &&
        event.outcome === "COMPENSATED" &&
        event.compensation === "AUTH_USER_DELETED",
    ),
  );
});

test("cleanup failure is explicit and leaves the Auth identity visible to reconciliation", async () => {
  const repository = makeRepository({
    profileFailure: true,
    compensationFailure: true,
  });
  const service = createAdminUserService(repository);

  await assert.rejects(
    service.createUser(serviceInput()),
    (error) =>
      error.code === "ADMIN_USER_COMPENSATION_REQUIRED" &&
      /requires administrator repair/.test(error.message),
  );

  assert.equal(repository.state.authUsers.length, 1);
  assert.equal(repository.state.profiles.length, 0);
  assert.ok(
    repository.state.audits.some(
      (event) =>
        event.action === "USER_CREATION_COMPENSATION_REQUIRED" && event.outcome === "CRITICAL",
    ),
  );

  const page = await service.listUsers({ page: 1, pageSize: 25 });
  assert.equal(page.users[0].syncStatus, "MISSING_PROFILE");
  assert.equal(page.users[0].id, CREATED_ID);
});

test("created temporary credentials can authenticate through the credential provider boundary", async () => {
  const repository = makeRepository();
  await createAdminUserService(repository).createUser(serviceInput());

  assert.equal(await repository.authenticate("adeel@beltcon.de", STRONG_PASSWORD), true);
  assert.equal(await repository.authenticate("adeel@beltcon.de", "WrongPassword123!"), false);
});

test("server repository uses Supabase Admin create/delete methods and secrets stay server-only", async () => {
  const [repositorySource, adminClientSource, migrationSource, clientSource] = await Promise.all([
    readFile(
      path.join(repositoryRoot, "src/services/admin/users/adminUserRepository.server.ts"),
      "utf8",
    ),
    readFile(path.join(repositoryRoot, "src/services/supabaseAdmin.server.ts"), "utf8"),
    readFile(
      path.join(repositoryRoot, "supabase/migrations/012_extend_profiles_for_user_creation.sql"),
      "utf8",
    ),
    readFile(path.join(repositoryRoot, "src/services/admin/users/adminUserClient.ts"), "utf8"),
  ]);

  assert.match(repositorySource, /auth\.admin\.createUser\(\{/);
  assert.match(repositorySource, /auth\.admin\.deleteUser\(userId\)/);
  assert.match(repositorySource, /email_confirm:\s*true/);
  assert.match(adminClientSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(clientSource, /SUPABASE_SERVICE_ROLE_KEY|service.?role/i);
  assert.doesNotMatch(migrationSource, /password_hash|temporary_password|credentials/i);
});
