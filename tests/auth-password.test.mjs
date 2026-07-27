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

const [accountModule, repositoryModule, policyModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/authAccount.server.ts"),
  vite.ssrLoadModule("/src/services/authRepository.server.ts"),
  vite.ssrLoadModule("/src/auth/passwordChangePolicy.ts"),
]);

const { createAuthAccountService, SAFE_SIGN_IN_MESSAGE } = accountModule;
const { handleAuthRequest } = repositoryModule;
const { blocksOperationalApi, passwordChangeRedirect } = policyModule;

const USER_ID = "00000000-0000-4000-8000-000000000301";
const EMAIL = "temporary.user@airport.test";
const OLD_PASSWORD = "TemporaryPass123!";
const NEW_PASSWORD = "PermanentPass456!";
const ACCESS_TOKEN = "valid-access-token-value-for-tests";
const REFRESH_TOKEN = "valid-refresh-token-value-for-tests";

function profile(overrides = {}) {
  return {
    id: USER_ID,
    firstName: "Temporary",
    lastName: "User",
    email: EMAIL,
    role: "Operations Officer",
    status: "ACTIVE",
    isActive: true,
    mustChangePassword: true,
    createdAt: "2026-07-27T14:00:00.000Z",
    lastLogin: null,
    ...overrides,
  };
}

function makeAuthState(options = {}) {
  const state = {
    profile: options.profile === undefined ? profile() : options.profile,
    password: OLD_PASSWORD,
    audits: [],
    recoveryRequests: [],
    otherSessionsRevoked: false,
    lastLogin: null,
  };

  const repository = {
    async findProfileByUserId(userId) {
      if (userId !== USER_ID || !state.profile) return null;
      return structuredClone(state.profile);
    },

    async updateLastLogin(userId, timestamp) {
      assert.equal(userId, USER_ID);
      state.lastLogin = timestamp;
    },

    async updatePassword(userId, newPassword) {
      assert.equal(userId, USER_ID);
      if (options.passwordUpdateFailure) {
        throw new Error("Simulated Supabase Auth password failure");
      }
      state.password = newPassword;
    },

    async revokeOtherSessions(accessToken) {
      assert.equal(accessToken, ACCESS_TOKEN);
      state.otherSessionsRevoked = true;
    },

    async completePasswordChange(input) {
      state.profile = {
        ...state.profile,
        mustChangePassword: false,
      };
      state.audits.push({
        action: "PASSWORD_CHANGED",
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        targetUserId: input.userId,
        outcome: "SUCCESS",
        requestId: input.requestId,
        timestamp: input.timestamp,
        otherSessionsRevoked: input.otherSessionsRevoked,
      });
      return structuredClone(state.profile);
    },

    async sendPasswordRecovery(email, redirectTo) {
      state.recoveryRequests.push({ email, redirectTo });
      if (options.recoveryFailure) throw new Error("Provider delivery failure");
    },
  };

  const accountService = createAuthAccountService(repository);

  async function exchangePassword(email, password) {
    if (email !== EMAIL || password !== state.password) {
      return { error: { message: "Invalid login credentials" } };
    }
    return {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 3600,
      user: { id: USER_ID, email: EMAIL },
    };
  }

  async function getUser(accessToken) {
    return accessToken === ACCESS_TOKEN ? { id: USER_ID, email: EMAIL } : null;
  }

  return { state, accountService, exchangePassword, getUser };
}

function jsonRequest(pathname, body, headers = {}) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function handlerOptions(authState) {
  return {
    accountService: authState.accountService,
    exchangePassword: authState.exchangePassword,
    getUser: authState.getUser,
  };
}

test("temporary-password user authenticates with complete profile state", async () => {
  const authState = makeAuthState();
  const response = await handleAuthRequest(
    jsonRequest("/api/auth/login", {
      email: EMAIL,
      password: OLD_PASSWORD,
    }),
    handlerOptions(authState),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, USER_ID);
  assert.equal(body.user.role, "Operations Officer");
  assert.equal(body.user.status, "ACTIVE");
  assert.equal(body.user.isActive, true);
  assert.equal(body.user.mustChangePassword, true);
  assert.ok(authState.state.lastLogin);
});

test("mandatory-password policy redirects pages and blocks operational APIs", () => {
  const user = {
    ...profile(),
    mustChangePassword: true,
  };

  assert.equal(passwordChangeRedirect("/tagging", user), "/change-password");
  assert.equal(passwordChangeRedirect("/recheck", user), "/change-password");
  assert.equal(passwordChangeRedirect("/dev/simulator", user), "/change-password");
  assert.equal(passwordChangeRedirect("/settings/users", user), "/change-password");
  assert.equal(passwordChangeRedirect("/change-password", user), null);
  assert.equal(blocksOperationalApi(user), true);
  assert.equal(passwordChangeRedirect("/tagging", { ...user, mustChangePassword: false }), null);
});

test("missing, inactive, suspended, locked, and deactivated profiles cannot log in", async () => {
  const cases = [
    null,
    profile({ isActive: false }),
    profile({ status: "PENDING", isActive: false }),
    profile({ status: "SUSPENDED", isActive: false }),
    profile({ status: "LOCKED", isActive: false }),
    profile({ status: "DEACTIVATED", isActive: false }),
  ];

  for (const ineligibleProfile of cases) {
    const authState = makeAuthState({ profile: ineligibleProfile });
    const response = await handleAuthRequest(
      jsonRequest("/api/auth/login", {
        email: EMAIL,
        password: OLD_PASSWORD,
      }),
      handlerOptions(authState),
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: SAFE_SIGN_IN_MESSAGE });
  }
});

test("password change updates Supabase credential boundary before clearing profile flag", async () => {
  const authState = makeAuthState();
  const response = await handleAuthRequest(
    jsonRequest(
      "/api/auth/change-password",
      {
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      {
        cookie: `etb_auth_token=${ACCESS_TOKEN}`,
        "x-request-id": "password-change-test-001",
      },
    ),
    handlerOptions(authState),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(authState.state.profile.mustChangePassword, false);
  assert.equal(authState.state.otherSessionsRevoked, true);
  assert.equal((await authState.exchangePassword(EMAIL, OLD_PASSWORD)).access_token, undefined);
  assert.equal((await authState.exchangePassword(EMAIL, NEW_PASSWORD)).access_token, ACCESS_TOKEN);
});

test("PASSWORD_CHANGED audit contains context but never a password", async () => {
  const authState = makeAuthState();
  await handleAuthRequest(
    jsonRequest(
      "/api/auth/change-password",
      {
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      {
        cookie: `etb_auth_token=${ACCESS_TOKEN}`,
        "x-request-id": "password-change-audit-001",
      },
    ),
    handlerOptions(authState),
  );

  assert.equal(authState.state.audits.length, 1);
  assert.equal(authState.state.audits[0].action, "PASSWORD_CHANGED");
  assert.equal(authState.state.audits[0].actorId, USER_ID);
  assert.equal(authState.state.audits[0].canonicalRole, "Operations Officer");
  const serializedAudit = JSON.stringify(authState.state.audits);
  assert.equal(serializedAudit.includes(NEW_PASSWORD), false);
  assert.equal(serializedAudit.includes(OLD_PASSWORD), false);
  assert.doesNotMatch(
    serializedAudit,
    /newPassword|confirmPassword|temporaryPassword|passwordHash/,
  );
});

test("password change requires a valid authenticated session", async () => {
  const authState = makeAuthState();
  const response = await handleAuthRequest(
    jsonRequest("/api/auth/change-password", {
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    }),
    handlerOptions(authState),
  );

  assert.equal(response.status, 401);
  assert.equal(authState.state.password, OLD_PASSWORD);
  assert.equal(authState.state.profile.mustChangePassword, true);
});

test("profile flag and audit remain unchanged when Supabase password update fails", async () => {
  const authState = makeAuthState({ passwordUpdateFailure: true });
  const response = await handleAuthRequest(
    jsonRequest(
      "/api/auth/change-password",
      {
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      { cookie: `etb_auth_token=${ACCESS_TOKEN}` },
    ),
    handlerOptions(authState),
  );

  assert.equal(response.status, 500);
  assert.equal(authState.state.password, OLD_PASSWORD);
  assert.equal(authState.state.profile.mustChangePassword, true);
  assert.equal(authState.state.audits.length, 0);
});

test("forgot-password always returns the same public response", async () => {
  const successfulState = makeAuthState();
  const failedState = makeAuthState({ recoveryFailure: true });

  const successful = await handleAuthRequest(
    jsonRequest("/api/auth/forgot-password", { email: EMAIL }),
    handlerOptions(successfulState),
  );
  const failed = await handleAuthRequest(
    jsonRequest("/api/auth/forgot-password", { email: "unknown@airport.test" }),
    handlerOptions(failedState),
  );
  const malformed = await handleAuthRequest(
    jsonRequest("/api/auth/forgot-password", { email: "not-an-email" }),
    handlerOptions(failedState),
  );

  assert.equal(successful.status, 200);
  assert.equal(failed.status, 200);
  assert.equal(malformed.status, 200);
  assert.deepEqual(await successful.json(), { ok: true });
  assert.deepEqual(await failed.json(), { ok: true });
  assert.deepEqual(await malformed.json(), { ok: true });
  assert.match(successfulState.state.recoveryRequests[0].redirectTo, /\/change-password$/);
});

test("forgot-password and recovery entry are public in middleware and root layout", async () => {
  const [middlewareSource, rootSource, forgotSource] = await Promise.all([
    readFile(path.join(repositoryRoot, "src/middleware/authMiddleware.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src/routes/__root.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src/routes/forgot-password.tsx"), "utf8"),
  ]);

  assert.match(middlewareSource, /"\/forgot-password"/);
  assert.match(middlewareSource, /"\/change-password"/);
  assert.match(rootSource, /pathname === "\/forgot-password"/);
  assert.match(rootSource, /pathname === "\/change-password"/);
  assert.match(forgotSource, /If an account exists for this email/);
});

test("implementation uses Supabase password and recovery APIs without credential persistence", async () => {
  const [accountSource, migrationSource, clientSource] = await Promise.all([
    readFile(path.join(repositoryRoot, "src/services/authAccount.server.ts"), "utf8"),
    readFile(
      path.join(repositoryRoot, "supabase/migrations/013_create_password_change_completion.sql"),
      "utf8",
    ),
    readFile(path.join(repositoryRoot, "src/services/passwordRecoveryClient.ts"), "utf8"),
  ]);

  assert.match(accountSource, /auth\.admin\.updateUserById\(userId/);
  assert.match(accountSource, /auth\.admin\.signOut\(accessToken, "others"\)/);
  assert.match(accountSource, /auth\.resetPasswordForEmail\(email/);
  assert.match(migrationSource, /'PASSWORD_CHANGED'/);
  assert.match(migrationSource, /must_change_password = FALSE/);
  assert.doesNotMatch(migrationSource, /new_password|password_hash|credentials/i);
  assert.doesNotMatch(clientSource, /SUPABASE_SERVICE_ROLE_KEY|service.?role/i);
});
