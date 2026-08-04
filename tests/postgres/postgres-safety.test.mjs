import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresHarness,
  postgresTestAvailability,
  redactPostgresFailure,
  validatePostgresTestTarget,
} from "./postgresHarness.mjs";

const configuredUrl = process.env.SBTS_TEST_DATABASE_URL;
const availability = postgresTestAvailability();

test("P2-DB-001 missing SBTS_TEST_DATABASE_URL is explicit", () => {
  const saved = process.env.SBTS_TEST_DATABASE_URL;
  delete process.env.SBTS_TEST_DATABASE_URL;
  try {
    assert.deepEqual(postgresTestAvailability(), {
      available: false,
      reason: "SBTS_TEST_DATABASE_URL is not configured",
    });
  } finally {
    if (saved === undefined) delete process.env.SBTS_TEST_DATABASE_URL;
    else process.env.SBTS_TEST_DATABASE_URL = saved;
  }
});

test("P2-DB-001 malformed and unsupported database URLs are refused", () => {
  assert.throws(() => validatePostgresTestTarget("not a url"), /valid PostgreSQL URL/);
  assert.throws(
    () => validatePostgresTestTarget("https://localhost/sbts_test"),
    /must be a PostgreSQL URL/,
  );
  assert.throws(
    () => validatePostgresTestTarget("postgresql://user:pass@localhost"),
    /database name is required/,
  );
});

test("P2-DB-001 unsafe and reserved database names are refused before harness creation", () => {
  for (const databaseName of ["airport", "beltrak", "postgres", "prod", "production", "sbts"])
    assert.throws(
      () => createPostgresHarness(`postgresql://user:pass@127.0.0.1/${databaseName}`),
      /reserved PostgreSQL database name/,
    );
  assert.throws(
    () => createPostgresHarness("postgresql://user:pass@127.0.0.1/sbts_stage"),
    /must contain 'test'/,
  );
});

test("P2-DB-001 production-like and Supabase hosts are always refused", () => {
  for (const hostname of [
    "production.db.internal",
    "db-prod.internal",
    "project.supabase.co",
    "project.supabase.com",
  ])
    assert.throws(
      () => validatePostgresTestTarget(`postgresql://user:pass@${hostname}/sbts_test`),
      /production-like|Supabase/,
    );
});

test("P2-DB-001 a remote CI target requires both explicit flags", () => {
  const url = "postgresql://ci:pass@database.internal/sbts_ci_test";
  assert.throws(() => validatePostgresTestTarget(url, {}), /must be local/);
  assert.throws(() => validatePostgresTestTarget(url, { CI: "true" }), /must be local/);
  assert.throws(
    () => validatePostgresTestTarget(url, { SBTS_ALLOW_REMOTE_TEST_DATABASE: "true" }),
    /must be local/,
  );
  assert.equal(
    validatePostgresTestTarget(url, {
      CI: "true",
      SBTS_ALLOW_REMOTE_TEST_DATABASE: "true",
    }).hostname,
    "database.internal",
  );
});

test("P2-DB-001 target summaries and failures redact passwords", () => {
  const url = "postgresql://sbts_user:do-not-print-this@127.0.0.1:55432/sbts_test";
  const target = validatePostgresTestTarget(url);
  assert.equal(target.summary, "sbts_user@127.0.0.1:55432/sbts_test");
  const redacted = redactPostgresFailure(`failed ${url} password=do-not-print-this`, url);
  assert.doesNotMatch(redacted, /do-not-print-this/);
  assert.match(redacted, /REDACTED/);
});

if (!availability.available) {
  test("P2-DB-001 live disposable target checks", { skip: availability.reason }, () => {
    if (process.env.SBTS_REQUIRE_POSTGRES_TESTS === "true") {
      throw new Error(availability.reason);
    }
  });
} else {
  const admin = createPostgresHarness(configuredUrl, { psqlPath: availability.psqlPath });

  test("P2-DB-001 valid local test database is reachable and writable", () => {
    assert.equal(admin.execute("SELECT current_database()"), availability.target.databaseName);
    assert.equal(
      admin.execute("BEGIN; CREATE TEMP TABLE sbts_safety_probe(v integer); ROLLBACK; SELECT 'ok'"),
      "ok",
    );
  });

  test("P2-DB-026 unreachable database fails without exposing its password", async () => {
    const unreachableUrl = "postgresql://sbts_user:unreachable-secret@127.0.0.1:1/sbts_test";
    const harness = createPostgresHarness(unreachableUrl, { psqlPath: availability.psqlPath });
    await assert.rejects(
      async () => harness.migrateClean(),
      (error) => {
        assert.doesNotMatch(error.message, /unreachable-secret/);
        assert.match(error.message, /connection|server|refused/i);
        return true;
      },
    );
  });

  test("P2-DB-001 read-only database role is rejected before schema reset", async () => {
    const role = "sbts_phase2_readonly_test";
    const password = "local-readonly-test-only";
    admin.execute(
      `DO $cleanup$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
           EXECUTE 'REVOKE CONNECT ON DATABASE ${availability.target.databaseName} FROM ${role}';
         END IF;
       END $cleanup$;
       DROP ROLE IF EXISTS ${role};
       CREATE ROLE ${role} LOGIN PASSWORD '${password}';
       ALTER ROLE ${role} SET default_transaction_read_only=on;
       GRANT CONNECT ON DATABASE ${availability.target.databaseName} TO ${role};`,
      { tuplesOnly: false },
    );
    const readonlyUrl = new URL(configuredUrl);
    readonlyUrl.username = role;
    readonlyUrl.password = password;
    const readonly = createPostgresHarness(readonlyUrl.toString(), {
      psqlPath: availability.psqlPath,
    });
    try {
      await assert.rejects(() => readonly.migrateClean(), /not a writable primary \(on:false\)/);
    } finally {
      admin.execute(
        `REVOKE CONNECT ON DATABASE ${availability.target.databaseName} FROM ${role}; DROP ROLE ${role}`,
        { tuplesOnly: false },
      );
    }
  });
}
