import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (relative) => readFile(path.join(root, relative), "utf8");

test("Phase 10 permission catalog retains legacy grants and adds atomic authorization codes", async () => {
  const permissions = await source("src/services/admin/roles/roleSchemas.ts");
  for (const code of [
    "bag.read",
    "bag.tag",
    "bag.recheck",
    "bag.resolve",
    "alarm.read",
    "alarm.acknowledge",
    "alarm.escalate",
    "rfid.read",
    "reader.manage",
    "user.create",
    "user.update",
    "user.suspend",
    "user.lock",
    "role.manage",
    "permission.manage",
    "simulator.use",
  ]) {
    assert.match(permissions, new RegExp(`"${code.replace(".", "\\.")}"`));
  }
  assert.match(permissions, /PERMISSION_CATALOG/);
});

test("central authorization fails closed for every account-state failure", async () => {
  const authorization = await source(
    "src/services/authorization/permissionAuthorization.server.ts",
  );
  for (const code of [
    "ACCOUNT_PROFILE_MISSING",
    "ACCOUNT_INACTIVE",
    "ACCOUNT_SUSPENDED",
    "ACCOUNT_LOCKED",
    "ACCOUNT_DEACTIVATED",
    "ACCOUNT_STATUS_INVALID",
  ]) {
    assert.match(authorization, new RegExp(code));
  }
  assert.match(authorization, /requireAnyPermission/);
  assert.doesNotMatch(authorization, /workspaceMode/);
});

test("workspace modes remain UI-only and simulators require a persisted permission", async () => {
  const [screening, bhs, rfid] = await Promise.all([
    source("src/services/screening/screeningSimulatorApi.server.ts"),
    source("src/services/bhs/bhsSimulatorApi.server.ts"),
    source("src/services/rfid/rfidSimulatorApi.server.ts"),
  ]);
  for (const serverSource of [screening, bhs, rfid]) {
    assert.match(serverSource, /"simulator\.use"/);
    assert.doesNotMatch(serverSource, /workspaceMode/);
  }
});

test("priority authentication forms use react-hook-form and Zod without browser password persistence", async () => {
  const [login, forgotPassword, changePassword, store] = await Promise.all([
    source("src/routes/login.tsx"),
    source("src/routes/forgot-password.tsx"),
    source("src/routes/change-password.tsx"),
    source("src/store/appStore.ts"),
  ]);
  for (const formSource of [login, forgotPassword, changePassword]) {
    assert.match(formSource, /useForm/);
    assert.match(formSource, /zodResolver/);
  }
  assert.doesNotMatch(store, /password/i);
  assert.doesNotMatch(login, /localStorage.*password|password.*localStorage/i);
  assert.doesNotMatch(changePassword, /localStorage.*password|password.*localStorage/i);
});

test("security migration is additive, retains migration history, and has no credential column", async () => {
  const migration = await source("supabase/migrations/023_create_beltcon_security_hardening.sql");
  assert.match(migration, /INSERT INTO public\.permissions/);
  assert.match(migration, /ON CONFLICT \(role_id, permission_id\) DO NOTHING/);
  assert.match(migration, /Self-escalation is not permitted/);
  assert.doesNotMatch(migration, /ADD COLUMN[^;]*(password|credential|token)/i);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM public\.profiles/i);
});

test("route and mutation protection retain server-side authorization boundaries", async () => {
  const [middleware, routeMap, users, roles] = await Promise.all([
    source("src/middleware/authMiddleware.ts"),
    source("src/auth/permissions.ts"),
    source("src/services/admin/users/adminUserApi.server.ts"),
    source("src/services/admin/roles/roleApi.server.ts"),
  ]);
  assert.match(middleware, /requireAnyPermission/);
  assert.match(routeMap, /\/dev\/simulator/);
  assert.match(users, /permissionForAdminUserAction/);
  assert.match(roles, /requirePermission/);
});

test("P2.1 removes direct authenticated writes and keeps UI mutations behind server APIs", async () => {
  const [migration, taggingRoute, recheckRoute] = await Promise.all([
    source("supabase/migrations/025_bhs_hbss_integrity_hardening.sql"),
    source("src/routes/tagging.tsx"),
    source("src/routes/recheck.tsx"),
  ]);
  for (const table of [
    "bags",
    "alarms",
    "rfid_events",
    "resolutions",
    "readers",
    "xray_scans",
    "screening_integration_events",
    "hbss_recall_requests",
    "audit_events",
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${table} FROM anon, authenticated`),
    );
  }
  assert.match(migration, /DROP POLICY IF EXISTS "auth_write_bags"/);
  assert.match(migration, /DROP POLICY IF EXISTS "auth_update_bags"/);
  assert.doesNotMatch(
    taggingRoute + recheckRoute,
    /getSupabase|supabase\.from|\.from\(["']bags["']\)/,
  );
});
