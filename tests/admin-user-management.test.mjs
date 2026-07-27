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

const [serviceModule, apiModule, errorsModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/admin/users/adminUserService.server.ts"),
  vite.ssrLoadModule("/src/services/admin/users/adminUserApi.server.ts"),
  vite.ssrLoadModule("/src/services/admin/users/adminUserErrors.ts"),
]);

const { createAdminUserService } = serviceModule;
const { handleAdminUserActionRequest, handleEditAdminUserRequest, handleInviteAdminUserRequest } =
  apiModule;
const { AdminUserError } = errorsModule;

const ACTOR_ID = "00000000-0000-4000-8000-000000000099";
const USER_ID = "00000000-0000-4000-8000-000000000201";
const INVITED_ID = "00000000-0000-4000-8000-000000000202";
const NOW = "2026-07-27T18:00:00.000Z";

function systemAdministratorSession(overrides = {}) {
  return {
    token: "server-session-token",
    expiresAt: "2026-07-27T20:00:00.000Z",
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

function authIdentity(id = USER_ID, overrides = {}) {
  return {
    id,
    email: "operator@airport.test",
    firstName: "Adeel",
    lastName: "Khan",
    createdAt: "2026-07-27T08:00:00.000Z",
    lastSignInAt: null,
    emailConfirmed: true,
    ...overrides,
  };
}

function profileIdentity(id = USER_ID, overrides = {}) {
  return {
    id,
    email: "operator@airport.test",
    firstName: "Adeel",
    lastName: "Khan",
    role: "Operations Officer",
    status: "ACTIVE",
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-07-27T08:00:00.000Z",
    lastLogin: null,
    updatedAt: "2026-07-27T08:00:00.000Z",
    createdBy: ACTOR_ID,
    version: 1,
    ...overrides,
  };
}

function makeRepository(options = {}) {
  const authUsers = structuredClone(options.authUsers ?? [authIdentity()]);
  const profiles = structuredClone(options.profiles ?? [profileIdentity()]);
  const audits = [];
  const calls = {
    invite: [],
    invitedProfile: [],
    update: [],
    transition: [],
    resend: [],
    reset: [],
  };

  const findAuthByEmail = (email) =>
    authUsers.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
  const findProfileByEmail = (email) =>
    profiles.find((profile) => profile.email.toLowerCase() === email.toLowerCase()) ?? null;

  return {
    state: { authUsers, profiles, audits, calls },

    async listAllAuthUsers() {
      return structuredClone(authUsers);
    },
    async listAllProfiles() {
      return structuredClone(profiles);
    },
    async findAuthUserById(userId) {
      return structuredClone(authUsers.find((user) => user.id === userId) ?? null);
    },
    async findAuthUserByEmail(email) {
      return structuredClone(findAuthByEmail(email));
    },
    async findProfileById(userId) {
      return structuredClone(profiles.find((profile) => profile.id === userId) ?? null);
    },
    async findProfileByEmail(email) {
      return structuredClone(findProfileByEmail(email));
    },
    async inviteAuthUser(input) {
      calls.invite.push(structuredClone(input));
      const user = authIdentity(INVITED_ID, {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        emailConfirmed: false,
      });
      authUsers.push(user);
      return {
        user: structuredClone(user),
        deliveryStatus: options.invitationDeliveryFailure ? "FAILED" : "SENT",
      };
    },
    async createInvitedProfile(input) {
      calls.invitedProfile.push(structuredClone(input));
      const authUser = authUsers.find((user) => user.id === input.userId);
      assert.ok(authUser, "Auth identity must exist before the invited profile");
      const profile = profileIdentity(input.userId, {
        email: authUser.email,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        status: "PENDING",
        isActive: false,
        mustChangePassword: true,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
        version: 1,
      });
      profiles.push(profile);
      audits.push({
        action: "USER_INVITED",
        targetUserId: input.userId,
        deliveryStatus: input.deliveryStatus,
      });
      return structuredClone(profile);
    },
    async updateProfile(input) {
      calls.update.push(structuredClone(input));
      if (options.editFailure) {
        throw new AdminUserError(
          "Unable to update the BELTrak user",
          "ADMIN_USER_PERSISTENCE_ERROR",
          500,
        );
      }
      const index = profiles.findIndex((profile) => profile.id === input.userId);
      if (index < 0) throw new Error("Missing profile");
      if (profiles[index].version !== input.expectedVersion) {
        throw new AdminUserError(
          "This user was changed by another administrator. Refresh and try again.",
          "ADMIN_USER_VERSION_CONFLICT",
          409,
        );
      }
      profiles[index] = {
        ...profiles[index],
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        status: input.isActive ? "ACTIVE" : "DEACTIVATED",
        isActive: input.isActive,
        updatedAt: input.timestamp,
        version: input.expectedVersion + 1,
      };
      audits.push({ action: "USER_UPDATED", reason: input.reason });
      return structuredClone(profiles[index]);
    },
    async transitionStatus(input) {
      calls.transition.push(structuredClone(input));
      if (options.actionFailure) {
        throw new AdminUserError(
          "Unable to change the BELTrak account status",
          "ADMIN_USER_PERSISTENCE_ERROR",
          500,
        );
      }
      const index = profiles.findIndex((profile) => profile.id === input.userId);
      if (index < 0) throw new Error("Missing profile");
      if (profiles[index].version !== input.expectedVersion) {
        throw new AdminUserError(
          "This user was changed by another administrator. Refresh and try again.",
          "ADMIN_USER_VERSION_CONFLICT",
          409,
        );
      }
      const nextStatus = {
        ACTIVATE: "ACTIVE",
        SUSPEND: "SUSPENDED",
        LOCK: "LOCKED",
        UNLOCK: "ACTIVE",
        DEACTIVATE: "DEACTIVATED",
      }[input.action];
      profiles[index] = {
        ...profiles[index],
        status: nextStatus,
        isActive: nextStatus === "ACTIVE",
        updatedAt: input.timestamp,
        version: input.expectedVersion + 1,
      };
      audits.push({ action: `USER_${input.action}`, reason: input.reason });
      return structuredClone(profiles[index]);
    },
    async resendInvitation(email, redirectTo) {
      calls.resend.push({ email, redirectTo });
      if (options.emailFailure) {
        throw new AdminUserError(
          "Supabase could not resend the password-setup invitation",
          "ADMIN_USER_EMAIL_DELIVERY_FAILED",
          502,
        );
      }
    },
    async sendPasswordReset(email, redirectTo) {
      calls.reset.push({ email, redirectTo });
      if (options.emailFailure) {
        throw new AdminUserError(
          "Supabase could not deliver the account email",
          "ADMIN_USER_EMAIL_DELIVERY_FAILED",
          502,
        );
      }
    },
    async recordAudit(input) {
      audits.push(structuredClone(input));
    },
    async deleteAuthUser(userId) {
      const authIndex = authUsers.findIndex((user) => user.id === userId);
      if (authIndex >= 0) authUsers.splice(authIndex, 1);
    },
  };
}

function inviteInput(overrides = {}) {
  return {
    firstName: "Reem",
    lastName: "Operations",
    email: "REEM@AIRPORT.TEST",
    role: "Operations Officer",
    actorId: ACTOR_ID,
    canonicalRole: "System Administrator",
    requestId: "invite-001",
    timestamp: NOW,
    redirectTo: "http://localhost/change-password",
    ...overrides,
  };
}

function editInput(overrides = {}) {
  return {
    userId: USER_ID,
    firstName: "Adeel",
    lastName: "Khan",
    role: "Customs Supervisor",
    isActive: true,
    expectedVersion: 1,
    reason: "Transfer approved by airport administration",
    actorId: ACTOR_ID,
    canonicalRole: "System Administrator",
    requestId: "edit-001",
    timestamp: NOW,
    ...overrides,
  };
}

function actionInput(action, expectedVersion = 1, overrides = {}) {
  return {
    userId: USER_ID,
    action,
    expectedVersion,
    reason: `Approved ${action.toLowerCase()} for security operations`,
    actorId: ACTOR_ID,
    canonicalRole: "System Administrator",
    requestId: `action-${action.toLowerCase()}`,
    timestamp: NOW,
    redirectTo: "http://localhost/change-password",
    ...overrides,
  };
}

test("invitation creates matching Auth and PENDING profile identities", async () => {
  const repository = makeRepository();
  const invitation = await createAdminUserService(repository).inviteUser(inviteInput());

  assert.equal(invitation.id, INVITED_ID);
  assert.equal(repository.state.authUsers.at(-1).id, repository.state.profiles.at(-1).id);
  assert.equal(repository.state.profiles.at(-1).status, "PENDING");
  assert.equal(repository.state.profiles.at(-1).role, "Operations Officer");
  assert.equal(repository.state.profiles.at(-1).isActive, false);
  assert.equal(invitation.deliveryStatus, "SENT");
  assert.equal(repository.state.audits.at(-1).action, "USER_INVITED");
});

test("invitation delivery failure retains one PENDING user for resend", async () => {
  const repository = makeRepository({ invitationDeliveryFailure: true });
  const invitation = await createAdminUserService(repository).inviteUser(inviteInput());

  assert.equal(invitation.deliveryStatus, "FAILED");
  assert.equal(invitation.status, "PENDING");
  assert.equal(repository.state.authUsers.filter((user) => user.id === INVITED_ID).length, 1);
  assert.equal(repository.state.profiles.filter((profile) => profile.id === INVITED_ID).length, 1);
  assert.equal(repository.state.audits.at(-1).deliveryStatus, "FAILED");
});

test("invitation endpoint rejects a non-administrator canonical role", async () => {
  let inviteCalls = 0;
  const response = await handleInviteAdminUserRequest(
    new Request("http://localhost/api/admin/users/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Reem",
        lastName: "Operations",
        email: "reem@airport.test",
        role: "Operations Officer",
      }),
    }),
    {
      getSession: async () =>
        systemAdministratorSession({
          role: "Operations Officer",
        }),
      service: {
        async inviteUser() {
          inviteCalls += 1;
        },
      },
    },
  );

  assert.equal(response.status, 403);
  assert.equal(inviteCalls, 0);
});

test("versioned edit updates the canonical role and active state", async () => {
  const repository = makeRepository();
  const user = await createAdminUserService(repository).editUser(editInput());

  assert.equal(user.role, "Customs Supervisor");
  assert.equal(user.status, "ACTIVE");
  assert.equal(user.version, 2);
  assert.equal(repository.state.calls.update[0].expectedVersion, 1);
  assert.equal(repository.state.audits.at(-1).reason, editInput().reason);
});

test("optimistic version conflict returns HTTP 409", async () => {
  const repository = makeRepository();
  const response = await handleEditAdminUserRequest(
    new Request(`http://localhost/api/admin/users/${USER_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Adeel",
        lastName: "Khan",
        role: "Customs Supervisor",
        isActive: true,
        expectedVersion: 99,
        reason: "Approved airport role transfer",
      }),
    }),
    USER_ID,
    {
      getSession: async () => systemAdministratorSession(),
      service: createAdminUserService(repository),
    },
  );

  assert.equal(response.status, 409);
  assert.match(await response.text(), /changed by another administrator/i);
});

test("suspend, lock, and deactivate wait for durable server transitions", async () => {
  const repository = makeRepository();
  const service = createAdminUserService(repository);

  const suspended = await service.performAction(actionInput("SUSPEND", 1));
  const locked = await service.performAction(actionInput("LOCK", 2));
  const deactivated = await service.performAction(actionInput("DEACTIVATE", 3));

  assert.equal(suspended.user.status, "SUSPENDED");
  assert.equal(locked.user.status, "LOCKED");
  assert.equal(deactivated.user.status, "DEACTIVATED");
  assert.equal(deactivated.user.isActive, false);
  assert.equal(repository.state.calls.transition.length, 3);
  assert.deepEqual(
    repository.state.calls.transition.map((call) => call.expectedVersion),
    [1, 2, 3],
  );
});

test("resend invitation and password reset use existing identity without duplication", async () => {
  const pendingRepository = makeRepository({
    profiles: [profileIdentity(USER_ID, { status: "PENDING", isActive: false })],
  });
  const pendingService = createAdminUserService(pendingRepository);
  const resend = await pendingService.performAction(actionInput("RESEND_INVITATION"));

  assert.equal(resend.deliveryStatus, "SENT");
  assert.equal(pendingRepository.state.calls.resend.length, 1);
  assert.equal(pendingRepository.state.authUsers.length, 1);
  assert.equal(pendingRepository.state.profiles.length, 1);
  assert.equal(
    pendingRepository.state.audits.find((event) => event.action === "USER_INVITATION_RESENT")
      .reason,
    actionInput("RESEND_INVITATION").reason,
  );

  const activeRepository = makeRepository();
  const reset = await createAdminUserService(activeRepository).performAction(
    actionInput("SEND_PASSWORD_RESET"),
  );
  assert.equal(reset.deliveryStatus, "SENT");
  assert.equal(activeRepository.state.calls.reset.length, 1);
  assert.equal(
    activeRepository.state.audits.find((event) => event.action === "PASSWORD_RESET_SENT").outcome,
    "SUCCESS",
  );
});

test("server failures reject the mutation and cannot produce a fake success", async () => {
  const repository = makeRepository({ actionFailure: true });

  await assert.rejects(
    createAdminUserService(repository).performAction(actionInput("SUSPEND")),
    (error) => error.code === "ADMIN_USER_PERSISTENCE_ERROR",
  );
  assert.equal(repository.state.profiles[0].status, "ACTIVE");
  assert.equal(repository.state.audits.length, 0);
});

test("action endpoint requires a reason and canonical System Administrator", async () => {
  const invalidReason = await handleAdminUserActionRequest(
    new Request(`http://localhost/api/admin/users/${USER_ID}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "LOCK",
        expectedVersion: 1,
        reason: "",
      }),
    }),
    USER_ID,
    {
      getSession: async () => systemAdministratorSession(),
      service: createAdminUserService(makeRepository()),
    },
  );
  assert.equal(invalidReason.status, 400);

  const forbidden = await handleAdminUserActionRequest(
    new Request(`http://localhost/api/admin/users/${USER_ID}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "LOCK",
        expectedVersion: 1,
        reason: "Security incident response",
      }),
    }),
    USER_ID,
    {
      getSession: async () =>
        systemAdministratorSession({
          role: "Operations Officer",
        }),
      service: createAdminUserService(makeRepository()),
    },
  );
  assert.equal(forbidden.status, 403);
});

test("user lifecycle migration enforces locking, versioning, transitions, and audit", async () => {
  const migration = await readFile(
    path.join(repositoryRoot, "supabase", "migrations", "014_create_admin_user_lifecycle.sql"),
    "utf8",
  );
  const repositorySource = await readFile(
    path.join(repositoryRoot, "src", "services", "admin", "users", "adminUserRepository.server.ts"),
    "utf8",
  );

  assert.match(migration, /create_invited_user_profile_v1/i);
  assert.match(migration, /update_admin_user_profile_v1/i);
  assert.match(migration, /transition_admin_user_status_v1/i);
  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /version = version \+ 1/i);
  assert.match(migration, /USER_ACTIVATED/);
  assert.match(migration, /USER_SUSPENDED/);
  assert.match(migration, /USER_LOCKED/);
  assert.match(migration, /USER_UNLOCKED/);
  assert.match(migration, /USER_DEACTIVATED/);
  assert.match(migration, /USER_PROFILE_REPAIRED/);
  assert.match(migration, /TO service_role/i);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/i);
  assert.match(repositorySource, /auth\.admin\.inviteUserByEmail/);
  assert.match(repositorySource, /resetPasswordForEmail/);
});

test("Manage Users UI is real, complete, and does not persist sensitive state", async () => {
  const [routeSource, dialogSource, clientSource] = await Promise.all(
    [
      "src/routes/settings.users.tsx",
      "src/features/admin/AdminUserDialogs.tsx",
      "src/services/admin/users/adminUserClient.ts",
    ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );
  const browserSource = `${routeSource}\n${dialogSource}\n${clientSource}`;

  assert.match(routeSource, /listAdminUsers/);
  assert.match(routeSource, /usersQuery\.isLoading/);
  assert.match(routeSource, /usersQuery\.isError/);
  assert.match(routeSource, /Retry/);
  assert.match(routeSource, /ADMIN_USER_STATUSES/);
  assert.match(routeSource, /Must change password/);
  assert.match(routeSource, /inviteAdminUser/);
  assert.match(routeSource, /editAdminUser/);
  assert.match(routeSource, /performAdminUserAction/);
  assert.match(routeSource, /repairAdminUserProfile/);
  assert.match(dialogSource, /clearSensitiveState/);
  assert.match(dialogSource, /temporaryPassword: ""/);
  assert.match(dialogSource, /Show temporary password/);
  assert.match(dialogSource, /At least 12 characters/);
  assert.match(dialogSource, /Reason/);
  assert.match(routeSource, /handleCreateUser/);
  assert.doesNotMatch(routeSource, /mutationFn:\s*createAdminUser/);
  assert.doesNotMatch(browserSource, /useAppStore/);
  assert.doesNotMatch(browserSource, /@\/mocks\/seed/);
  assert.doesNotMatch(browserSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(browserSource, /SUPABASE_SERVICE_ROLE_KEY/);
});
