import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDirectory = path.join(repositoryRoot, "supabase", "migrations");

function loadLocalTestEnvironment() {
  const environmentPath = path.join(repositoryRoot, ".env.test.local");
  if (!existsSync(environmentPath)) return;
  for (const line of readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[2].startsWith("#") || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadLocalTestEnvironment();

const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const reservedDatabaseNames = new Set([
  "airport",
  "beltrak",
  "postgres",
  "prod",
  "production",
  "sbts",
  "template0",
  "template1",
]);

function canExecute(executable) {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

function findPsqlExecutable() {
  const configuredPath = process.env.SBTS_PSQL_PATH?.trim();
  if (configuredPath && canExecute(configuredPath)) return configuredPath;
  if (canExecute("psql")) return "psql";
  if (process.platform !== "win32") return null;

  const installationRoot = "C:\\Program Files\\PostgreSQL";
  if (!existsSync(installationRoot)) return null;
  const candidates = readdirSync(installationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(installationRoot, entry.name, "bin", "psql.exe"))
    .filter(existsSync)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return candidates.find(canExecute) ?? null;
}

function enabled(value) {
  return String(value).toLowerCase() === "true";
}

export function validatePostgresTestTarget(value, environment = process.env) {
  if (!value?.trim()) throw new Error("SBTS_TEST_DATABASE_URL is not configured");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("SBTS_TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("SBTS_TEST_DATABASE_URL must be a PostgreSQL URL");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1)).trim().toLowerCase();
  if (!databaseName) throw new Error("Disposable PostgreSQL database name is required");
  if (reservedDatabaseNames.has(databaseName)) {
    throw new Error(`Refusing reserved PostgreSQL database name '${databaseName}'`);
  }
  if (!databaseName.includes("test")) {
    throw new Error("Disposable PostgreSQL database name must contain 'test'");
  }

  const hostname = url.hostname.toLowerCase();
  const looksProduction =
    hostname.endsWith(".supabase.co") ||
    hostname.endsWith(".supabase.com") ||
    /(^|[.-])(prod|production)([.-]|$)/i.test(hostname);
  if (looksProduction) {
    throw new Error("Refusing a production-like or hosted Supabase PostgreSQL target");
  }

  const remoteCiOverride =
    enabled(environment.CI) && enabled(environment.SBTS_ALLOW_REMOTE_TEST_DATABASE);
  if (!localDatabaseHosts.has(hostname) && !remoteCiOverride) {
    throw new Error(
      "Disposable PostgreSQL target must be local; remote targets require CI=true and SBTS_ALLOW_REMOTE_TEST_DATABASE=true",
    );
  }

  return {
    databaseUrl: value.trim(),
    databaseName,
    hostname,
    port: url.port || "5432",
    username: decodeURIComponent(url.username || "(default)"),
    summary: `${decodeURIComponent(url.username || "(default)")}@${hostname}:${url.port || "5432"}/${databaseName}`,
  };
}

function redactSensitiveText(value, databaseUrl) {
  let redacted = String(value ?? "");
  try {
    const url = new URL(databaseUrl);
    if (url.password) redacted = redacted.replaceAll(url.password, "[REDACTED]");
    redacted = redacted.replaceAll(
      databaseUrl,
      `${url.protocol}//[REDACTED]@${url.host}${url.pathname}`,
    );
  } catch {
    // Validation reports malformed URLs without echoing their contents.
  }
  return redacted;
}

export function redactPostgresFailure(value, databaseUrl) {
  return redactSensitiveText(value, databaseUrl);
}

export async function discoverPostgresMigrations() {
  return (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));
}

export function postgresTestAvailability() {
  const value = process.env.SBTS_TEST_DATABASE_URL?.trim();
  if (!value) {
    return {
      available: false,
      reason: "SBTS_TEST_DATABASE_URL is not configured",
    };
  }
  let target;
  try {
    target = validatePostgresTestTarget(value);
  } catch (error) {
    return { available: false, reason: error.message };
  }
  const psqlPath = findPsqlExecutable();
  if (!psqlPath) {
    return { available: false, reason: "psql is not installed or not on PATH" };
  }
  return { available: true, databaseUrl: target.databaseUrl, target, psqlPath };
}

function commandArguments(databaseUrl, extra = []) {
  return ["--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "--dbname", databaseUrl, ...extra];
}

function failureMessage(result, databaseUrl) {
  return redactSensitiveText(
    [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
    databaseUrl,
  );
}

export function createPostgresHarness(databaseUrl, options = {}) {
  const target = validatePostgresTestTarget(databaseUrl);
  const psqlPath = options.psqlPath ?? findPsqlExecutable();
  if (!psqlPath) throw new Error("psql is not installed or not on PATH");

  function execute(sql, { tuplesOnly = true } = {}) {
    const args = commandArguments(databaseUrl, [
      ...(tuplesOnly ? ["--tuples-only", "--no-align"] : []),
      "--command",
      sql,
    ]);
    const result = spawnSync(psqlPath, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(failureMessage(result, databaseUrl));
    return result.stdout.trim();
  }

  function executeAsync(sql) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        psqlPath,
        commandArguments(databaseUrl, ["--tuples-only", "--no-align", "--command", sql]),
        { windowsHide: true },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else
          reject(
            new Error(
              redactSensitiveText([stderr, stdout].filter(Boolean).join("\n").trim(), databaseUrl),
            ),
          );
      });
    });
  }

  async function migrateClean() {
    const connectedDatabase = execute("SELECT current_database()").toLowerCase();
    if (connectedDatabase !== target.databaseName) {
      throw new Error(
        `Connected PostgreSQL database '${connectedDatabase}' does not match validated target '${target.databaseName}'`,
      );
    }
    const serverState = execute(
      "SELECT current_setting('transaction_read_only')||':'||pg_is_in_recovery()::text",
    );
    if (serverState !== "off:false") {
      throw new Error(`Disposable PostgreSQL target is not a writable primary (${serverState})`);
    }
    execute(
      "BEGIN; CREATE TEMP TABLE sbts_write_probe(value integer); INSERT INTO sbts_write_probe VALUES(1); ROLLBACK",
      { tuplesOnly: false },
    );

    resetTestSchemas();
    await applyMigrations();
  }

  function resetTestSchemas() {
    execute(
      `
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP SCHEMA IF EXISTS auth CASCADE;
      CREATE SCHEMA public;
      CREATE SCHEMA auth;
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END
      $roles$;
      ALTER ROLE service_role BYPASSRLS;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      DO $publication$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
          EXECUTE 'CREATE PUBLICATION supabase_realtime';
        END IF;
      END
      $publication$;
      CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
      LANGUAGE sql STABLE AS $uid$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
      $uid$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      `,
      { tuplesOnly: false },
    );
  }

  async function applyMigrations({ from = 1, through = Number.POSITIVE_INFINITY } = {}) {
    const migrations = (await discoverPostgresMigrations()).filter((migration) => {
      const sequence = Number.parseInt(migration.split("_", 1)[0], 10);
      return sequence >= from && sequence <= through;
    });
    for (const migration of migrations) {
      const result = spawnSync(
        psqlPath,
        commandArguments(databaseUrl, [
          "--single-transaction",
          "--file",
          path.join(migrationsDirectory, migration),
        ]),
        {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      if (result.status !== 0) {
        throw new Error(`${migration}: ${failureMessage(result, databaseUrl)}`);
      }
    }
    return migrations;
  }

  function resetOperationalData() {
    execute(
      `TRUNCATE TABLE
        public.tag_inventory_imports,
        public.tagging_operation_requests,
        public.tagging_session_events,
        public.bag_photos,
        public.tag_verification_attempts,
        public.tag_provisioning_jobs,
        public.epc_reservations,
        public.tagging_sessions,
        public.bag_tag_assignments,
        public.tagging_station_queue_items,
        public.tagging_station_configurations,
        public.audit_events,
        public.hbss_recall_requests,
        public.alarm_actions,
        public.resolutions,
        public.alarms,
        public.tags,
        public.rfid_events,
        public.xray_scans,
        public.screening_integration_events,
        public.bags
      RESTART IDENTITY CASCADE`,
      { tuplesOnly: false },
    );
  }

  return {
    applyMigrations,
    execute,
    executeAsync,
    migrateClean,
    resetOperationalData,
    resetTestSchemas,
    target,
  };
}

export function sqlJson(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

export function parseJsonOutput(output) {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .findLast(Boolean);
  if (!line) throw new Error("PostgreSQL query returned no JSON");
  return JSON.parse(line);
}
