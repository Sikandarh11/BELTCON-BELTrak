# SBTS Phase 2 software verification report

Report date: 2026-08-03

## Status

- PHASE 2 SOFTWARE: PASS
- POSTGRESQL GATE: PASS
- SOFTWARE FAT: PASS
- VENDOR INTEGRATION: PENDING
- PHYSICAL HARDWARE: PENDING

This is a software-only result. It does not certify Profinet, RS-232 hardware, Smiths HBSS, physical X-Ray transfer, RFID equipment, scanners, conveyors, the airport network, or airport deployment packaging.

## Executed evidence

| Gate                       | Registered | Passed | Failed | Skipped/TODO |
| -------------------------- | ---------: | -----: | -----: | -----------: |
| Real PostgreSQL            |         60 |     60 |      0 |            0 |
| Software FAT               |         20 |     20 |      0 |            0 |
| Station-host local process |          1 |      1 |      0 |            0 |
| BHS focused                |         80 |     80 |      0 |            0 |
| HBSS focused               |        112 |    112 |      0 |            0 |
| Station focused            |         41 |     41 |      0 |            0 |
| Serial focused             |         23 |     23 |      0 |            0 |

Static verification also passed TypeScript, repository-wide semantic ESLint (0 errors, 6 existing Fast Refresh warnings), the complete changed-file ESLint scan, the Phase 2 Prettier gate, migration drift, `git diff --check`, and the production build.

The PostgreSQL suite uses PostgreSQL 17.10 on `sbts_test@127.0.0.1:55432/sbts_test`. It applied migrations 001–026 from clean state and tested upgrade from 024 through 025/026. Passwords are omitted.

## Database results

- VERIFIED: catalog queries confirmed core/integration tables, columns, functions, triggers, indexes, constraints, RLS, and grants.
- VERIFIED: `anon`, `authenticated`, and `service_role` are real PostgreSQL roles; tests use real role switching and JWT subject claims. `service_role` uses `BYPASSRLS` to match Supabase behavior.
- VERIFIED: authenticated direct operational writes and audit mutations fail. Service role can append but not update/delete audit history.
- VERIFIED: BHS ACCEPT, all non-ACCEPT values, duplicates, conflict orders, transaction faults, response loss, and real concurrent clients converge without duplicate bags.
- VERIFIED: HBSS/X-Ray exact identity, source-scoped external IDs, rollback, direct ingestion, immutable external identity, and cross-bag rejection execute against PostgreSQL.
- VERIFIED: BHS-first, HBSS-first, and simultaneous ingestion retain one internal bag identity.
- VERIFIED: defaults to `BASE_ALWAJH`; optional IATA, threat data, and a local X-Ray are not required. `ENHANCED_EVIDENCE` is explicit opt-in.
- VERIFIED: tag assignment creates one immutable `tags` row, is retry-safe, and prevents EPC/barcode reuse.
- VERIFIED: migration 026 station metadata is durable and cannot be rebound to another station/site.
- VERIFIED: recall requests are durable and idempotent. `REQUEST_SENT` does not imply acknowledgement or image retrieval.
- VERIFIED: migration files run with stop-on-error and one transaction per file.

## Defects found and fixed

1. Station metadata test queried internal event `id` using the external event ID; corrected to `event_id`.
2. Harness `service_role` did not emulate Supabase `BYPASSRLS`; corrected.
3. Trusted X-Ray writes could not execute the readiness trigger; granted the required refresh function.
4. Readiness incorrectly required screening/threat/X-Ray evidence for the default; added explicit base/enhanced policy.
5. No relational tag table existed and identical retries were not idempotent; added immutable `tags` association and duplicate convergence.
6. Service role inherited audit update/delete privileges; explicitly revoked them.
7. Migrations were not individually atomic; added `--single-transaction`.
8. Central recall vocabulary asserted unsupported acknowledgement/completion states; replaced with conservative `REQUEST_SENT`/failure states.
9. Test target safety lacked host/reserved-name/read-only/redaction checks; added and executed them.
10. PostgreSQL was not available locally; PostgreSQL 17.10 was installed and a disposable test database configured.
11. Direct X-Ray ingestion could deadlock under high contention; added identity-scoped advisory serialization and verified zero unresolved deadlocks in the 100-client load case.

## FAT classification

FAT-SW-001–010, 013, and 015–019 are `PASS — VERIFIED BY SOFTWARE TEST`. FAT-SW-011, 012, 014, and 020 are `SIMULATED ONLY` where they cross virtual serial/mock X-Ray boundaries. All twenty scenario assertions pass. Detailed sanitized runtime reports are generated under `artifacts/software-fat/`.

## Compatibility and deployment risks

- Migration 025 is not yet a published repository migration in the current worktree, so these corrections are included there without rewriting pushed history. If any environment has already applied an earlier draft with the same migration number, deployment must use a new forward migration instead of editing history.
- Migration 024’s `bags.bhs_uid` is NOT NULL; the requested nullable-BHS legacy case is not representable in the actual 024 schema. Constraints added for legacy data remain `NOT VALID` where designed.
- Existing tagged bags are backfilled into `tags`. Predeployment checks must resolve any out-of-band duplicates that violate the existing unique bag indexes.
- V1 is a single-airport identity model. Station delivery takeover is blocked, but full multi-site row-level read isolation for bags/X-Ray requires an approved site-ownership model.
- The legacy full-tree `eslint .` command also runs Prettier and reports existing CRLF/formatting debt in untouched files. CI therefore runs repository-wide semantic ESLint through `lint:ci` and the explicit Phase 2 formatting gate separately; unrelated legacy files were not bulk-reformatted.

## Remaining blockers

BLOCKER: final BHS vendor ICD, Profinet mapping/GSD, message 2002 Ack value, queue-full Ack policy, final HBSS framing, physical response protocol (if any), Smiths image-transfer/authentication contract, and target hardware/network are unavailable. See `SBTS-PHASE-2-LIMITATION-REGISTER.md`.

RECOMMENDED: run the included GitHub software gate, then schedule separate vendor FAT and physical SAT. Do not add hardware tests to the normal software CI gate.
