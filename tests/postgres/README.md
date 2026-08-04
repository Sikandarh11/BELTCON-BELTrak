# Disposable PostgreSQL integration suite

This gate executes migrations 001–026 and the BHS/HBSS integrity cases against a real disposable PostgreSQL server. It never uses a browser database mock.

## Preferred local workflow

With Docker installed:

```powershell
npm.cmd run test:db:start
npm.cmd run test:db:reset
npm.cmd run test:postgres
npm.cmd run fat:software
npm.cmd run test:db:stop
```

`test:db:start` creates `.env.test.local` (gitignored), waits for the PostgreSQL 17 container, and records only test credentials. `test:db:stop` removes the repository-managed container and its temporary data. It never stops or deletes an existing local PostgreSQL installation.

For an existing local PostgreSQL server, copy `.env.test.example` to `.env.test.local`, change only the disposable local connection values, and ensure the role can create schemas, extensions, test roles, and a publication. The harness finds `psql` on `PATH`, through `SBTS_PSQL_PATH`, or in a standard Windows PostgreSQL installation.

## Destructive scope and safety

The configured database is disposable test scope. After validation and a live read/write probe, the harness drops and recreates only its `public` and `auth` schemas, creates the local Supabase role emulation, and applies every numbered migration in filename order with `ON_ERROR_STOP` and `--single-transaction` per migration.

The harness refuses:

- missing, malformed, or non-PostgreSQL URLs;
- database names without `test`;
- reserved names including `postgres`, `production`, `prod`, `sbts`, and `airport`;
- production-like and Supabase production hostnames;
- non-local hosts unless both `CI=true` and `SBTS_ALLOW_REMOTE_TEST_DATABASE=true` are set;
- a connected database whose real name differs from the validated URL;
- read-only servers/users and recovery replicas.

Messages print `user@host:port/database` only. Passwords and full URLs are redacted. CI sets `SBTS_REQUIRE_POSTGRES_TESTS=true`, so a missing database or `psql` is a failure rather than a skipped certification.

## Role emulation

The disposable database creates `anon`, `authenticated`, and `service_role`. Tests use `SET LOCAL ROLE`, JWT subject GUCs, and real RLS. `service_role` has `BYPASSRLS`, matching the Supabase service role, while grants/revocations still verify approved mutation surfaces. Operational data is reset with one explicit `TRUNCATE ... RESTART IDENTITY CASCADE` list between cases.

## Reports

`npm.cmd run fat:software` writes sanitized JSON and Markdown to `artifacts/software-fat/`. `npm.cmd run test:station-host` writes its local-process result to `artifacts/station-host-smoke/`. The directory is gitignored and uploaded by the Phase 2 CI workflow.
