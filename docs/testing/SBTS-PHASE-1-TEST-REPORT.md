# SBTS Phase 1 test report

Report date: 2026-08-02

## Result

Focused command:

```text
npm run test:p1
```

Result: 139 registered tests: 92 passing, 0 failing, 47 TODO, 0 skipped, 0 cancelled.

The 47 TODO cases are not represented as passes. They name the required lifecycle and generic CRUD behaviors for which no production state-machine or generic bag service currently exists.

Pre-change full-suite baseline: 239 passing, 0 failing.

Post-change full-suite result (`npm test`): 312 registered tests: 265 passing, 0 failing, 47 TODO, 0 skipped, 0 cancelled. `npm run typecheck` and targeted ESLint for all new test directories also pass. The repository-wide `npm run lint` did not finish within a 120-second verification window, so it is not claimed as passing.

## Test files created

- `tests/unit/test-infrastructure.test.mjs`: deterministic clock/UUID, auth request/session, reset behavior, database and integration mock smoke tests.
- `tests/unit/fixture-validation.test.mjs`: validates all standard fixtures through applicable real project schemas.
- `tests/unit/bag-lifecycle.test.mjs`: current lifecycle/RPC conformance plus explicit required-lifecycle TODOs.
- `tests/unit/bag-crud.test.mjs`: current schema/persistence conformance plus explicit generic CRUD TODOs.
- `tests/fixtures/bagFixtures.mjs`: 15 required bags and levels 1-5.
- `tests/fixtures/userFixtures.mjs`: administrator, tagging/customs/control-centre operators, supervisor, disabled, and permission-limited users.
- `tests/fixtures/readerFixtures.mjs`: ten required reader conditions and required-to-real zone mapping.
- `tests/fixtures/tagFixtures.mjs`, `bhsFixtures.mjs`, `hbssFixtures.mjs`: reusable tag, RFID event, BHS, scan, and X-Ray builders.
- `tests/mocks/*.mjs`: database/repository, BHS, HBSS, RFID reader/printer, GPIO, message bus, WebSocket, clock, UUID, and operation spies.
- `tests/helpers/*.mjs`: test context, authenticated request/session, audit/error assertions, and Vite module loader.

`tests/integration/README.md` and `tests/e2e/README.md` reserve the requested structure without inventing hardware or browser scenarios.

## Files modified

- `package.json`: includes the new unit files in `npm test`; adds `test:p1` and `test:p1:coverage`.

Production files modified: none.

## Utility summary

- Builders use deterministic safe defaults, non-production identifiers, no real passenger information, and accept field overrides.
- Standard EPC and BHS UID values are unique. Intentional invalidity is labeled with `fixture_validity`.
- `createTestContext(t)` creates every dependency double and registers cleanup on the test context.
- Repository methods are scripted and fail on unscripted calls, preventing accidental fake success.
- The clock supports direct injection; `installFakeTimers` controls global `Date` without sleep calls.
- Message bus, RFID, and WebSocket mocks deliver synchronously/through awaited callbacks, so no arbitrary delay is needed.

The foundation-only smoke command is `npm run test:p1:foundation`. It runs without internet, production Supabase, or physical equipment and currently reports 6 passing, 0 failing tests.

## Coverage

Coverage command:

```text
npm run test:p1:coverage
```

Node reports the new test-support modules at 96.80% lines, 90.97% branches, and 85.71% functions. Vite SSR transforms production TypeScript, and Node's built-in coverage output does not attribute those transformed modules to their source files. A production line-coverage percentage would therefore be misleading and is not reported.

Functional coverage:

| Area              | Current P1 coverage                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bag domain        | Existing BHS suspect creation and tagging are reused; 20 generic CRUD behaviors are TODO because there is no generic bag service/schema.                                                      |
| State transitions | Five current SQL mutation paths have conformance checks. All 13 requested valid transitions, 8 invalid transitions, and 6 additional lifecycle rules are TODO pending a real state machine.   |
| Schema validation | All 15 bags, 10 readers, 7 users, 5 threat levels, and BHS/HBSS/RFID builders pass applicable exported schemas; complete-bag schema coverage is unavailable because none exists.              |
| Audit behavior    | Current tag, RFID location, Customs alarm, recheck, and screening audits are covered by reused tests/source conformance. Exhaustive transition audit behavior is TODO with the state machine. |

## Known missing cases

- Required lifecycle-vocabulary behavior and invalid transitions.
- Closed-case modification/reopen policy.
- Generic bag create/read/update/archive service behavior.
- Complete strict bag-schema tests, including unexpected fields.
- Generic authorization policy for threat-level changes.
- Browser E2E and a disposable real PostgreSQL/Supabase integration environment.

## Technical debt and production defects found

1. `src/services/bagPersistenceMappings.ts` maps an unknown database status to `IDENTIFIED` instead of rejecting it. This can hide corrupt or newer state values.
2. The same mapper loses information: `AT_EXIT` becomes `IN_TRANSIT`; `ESCAPE_ALERT` and `ESCALATED` become `ALARMED`.
3. The database, TypeScript DTO, and requested lifecycle each use different status vocabularies.
4. The Customs Exit RPC jumps directly from `TAGGED`/`IN_ARRIVAL_HALL` to `ALARMED`; it does not expose the requested `AT_EXIT -> ALARMED` transition.
5. Recheck stores only `CLEARED`/`NOT_CLEARED` and changes the bag to `RESOLVED`; required `CONFISCATED`, `ESCALATED`, and `CLOSED` bag transitions do not exist.
6. `bagToRow` uses `new Date()` when `updatedAt` is absent, so this persistence mapping has no injectable clock.
7. No generic bag service, repository, API, strict bag schema, archive policy, or `BAG_CREATED` event exists.
8. Threat requirements conflict: current screening/database validation uses levels 1-5, while `src/routes/settings.threats.tsx` says the product deliberately avoids five-tier severity.

The smallest safe fix is not to edit historical migrations. First approve the lifecycle and threat decisions, then add one forward migration plus a central strict state machine; update the mapper to preserve approved states and throw on unknown ones. P1 intentionally did not make those business changes.

## Deferred to P2

- Physical BHS transport.
- Physical HBSS/X-Ray vendor transport.
- RFID reader and printer hardware.
- GPIO alarm control.
- Portal/alarm business scenarios beyond the existing repository tests.
- Recheck image-retrieval scenarios beyond the existing repository tests.
- Message-bus/WebSocket production delivery.
- Browser automation.
