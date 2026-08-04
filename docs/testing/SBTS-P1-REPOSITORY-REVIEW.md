# SBTS Phase 1 repository review

Review date: 2026-08-02

## Existing testing stack

- Runner: Node.js `node:test` with `node:assert/strict`.
- TypeScript loading: a middleware-mode Vite server and `vite.ssrLoadModule`, with `@` mapped to `src`.
- Existing scope before P1: 239 passing tests in 27 `.test.mjs` files.
- Repository doubles: individual tests define in-memory repositories and inject them through service factories.
- Browser E2E: none. The file named `beltcon-sbts-e2e-baseline.test.mjs` is a Node contract test, not Playwright.
- Not present: Vitest, Jest, Playwright, Testing Library, a test config file, shared fixtures, global mock cleanup, or a coverage script.

The pre-change command `npm test` completed with 239 passing and 0 failing tests.

## Important project paths

| Area                       | Authoritative paths                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Test entry/configuration   | `package.json`, `tests/*.test.mjs`                                                                     |
| Bag DTO and status mapping | `src/types/bag.ts`, `src/services/bagPersistenceMappings.ts`                                           |
| Baseline BHS contract      | `src/domain/beltcon-sbts-baseline/*`                                                                   |
| BHS ingestion              | `src/services/bhs/*`, `src/routes/api.integrations.bhs.messages.ts`                                    |
| Suspect/HBSS screening     | `src/types/screening.ts`, `src/services/screening/*`, `src/services/integrations/screening/*`          |
| Tag assignment             | `src/services/bags/tagging*`, `src/routes/api.bags.$bagId.assign-tag.ts`                               |
| RFID movement              | `src/services/rfid/*`, `src/services/bags/rfidTrackable*`, `src/routes/api.integrations.rfid.reads.ts` |
| Customs alarms             | `src/services/alarms/*`, `src/routes/api.alarms*`                                                      |
| Recheck/resolution         | `src/services/recheck/*`, `src/routes/api.recheck*`                                                    |
| X-Ray/HBSS retrieval       | `src/services/xray/*`, `src/services/integrations/hbss/*`                                              |
| Readers                    | `src/services/readers/*`, `src/services/rfid/readerAntenna*`                                           |
| Authorization/audit        | `src/services/authorization/*`, `src/services/audit/*`, `src/auth/*`                                   |
| Database authority         | `supabase/migrations/003`, `007`, `009`, and `016` through `024`                                       |

There is no generic server-side bag CRUD service, bag repository interface, bag API handler, exported bag schema, or central lifecycle state machine. The deprecated `src/services/bagService.ts` facade only delegates tag encoding and throws for other browser lifecycle operations.

## Domain services, repositories, APIs, and schemas

Server service factories currently exist for admin users/roles, alarms, audit, auth accounts, tagging, BHS ingestion, screening ingestion, readers, recheck, reports, RFID reads, and X-Ray retrieval. Each of those areas has a server repository or an injected dependency seam. Bag operations are distributed among those feature services and SQL RPCs.

| Domain              | Service                                         | Repository                                                            | API handler                                          | Schema/type authority                                   |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Bag tagging         | `bags/taggingService.server.ts`                 | `bags/taggingRepository.server.ts`                                    | `bags/taggingApi.server.ts`                          | baseline tag schema plus private repository row schemas |
| RFID-trackable bags | no service layer                                | `bags/rfidTrackableRepository.server.ts`                              | `bags/rfidTrackableApi.server.ts`                    | `types/rfid.ts`                                         |
| BHS messages        | `bhs/bhsMessageService.server.ts`               | `bhs/bhsMessageRepository.server.ts`, pending-confirmation repository | `bhs/bhsMessageApi.server.ts`, simulator API         | baseline BHS schemas and `bhsMessageTypes.ts`           |
| Screening ingestion | `screening/screeningIngestionService.server.ts` | `screening/screeningRepository.server.ts`                             | `screening/screeningApi.server.ts`, simulator API    | `types/screening.ts`, integration screening schemas     |
| RFID reads          | `rfid/rfidReadService.server.ts`                | `rfid/rfidReadRepository.server.ts`, antenna repository               | `rfid/rfidReadApi.server.ts`, simulator/antenna APIs | `rfid/rfidReadSchemas.ts`, `rfidReadTypes.ts`           |
| Alarms              | `alarms/alarmService.server.ts`                 | `alarms/alarmRepository.server.ts`                                    | `alarms/alarmApi.server.ts`                          | `alarms/alarmSchemas.ts`, `alarmErrors.ts`              |
| Recheck             | `recheck/recheckService.server.ts`              | `recheck/recheckRepository.server.ts`                                 | `recheck/recheckApi.server.ts`                       | `recheck/recheckSchemas.ts`, `recheckTypes.ts`          |
| X-Ray/HBSS          | `xray/xrayService.server.ts`                    | X-Ray, bag, and view-audit repositories                               | `xray/xrayApi.server.ts`                             | HBSS schemas and `types/xray.ts`                        |
| Readers             | `readers/readerService.server.ts`               | `readers/readerRepository.server.ts`                                  | `readers/readerApi.server.ts`                        | `readers/readerSchemas.ts`                              |
| Audit/reports       | audit and report services                       | audit/report repositories                                             | audit/report APIs                                    | audit/report schemas                                    |
| Users/roles         | admin user and role services                    | admin user and role repositories                                      | admin user and role APIs                             | admin user and role schemas                             |

The exported schemas relevant to bags are:

- `beltconSbtsBaseline.schemas.ts`: BHS line/UID, IATA LPC, BHS messages, tag association, HBSS recall.
- `types/screening.ts` and `integrations/screening/screeningSchemas.ts`: suspect screening event, X-Ray image/scan, threat level 1-5.
- `rfid/rfidReadSchemas.ts`: RFID read and reader antenna mapping.
- `integrations/hbss/hbssSchemas.ts`: HBSS scan results and image references.
- `alarms/alarmSchemas.ts` and `recheck/recheckSchemas.ts`: alarm/recheck commands.

No exported schema validates a complete stored bag or a generic create/update bag command.

## Real lifecycle compared with the requested lifecycle

The database check in migration `003_create_core_tables.sql` permits:

`IDENTIFIED`, `TAGGED`, `IN_ARRIVAL_HALL`, `AT_EXIT`, `ALARMED`, `UNDER_RECHECK`, `RESOLVED`, `MISSING`, `ESCAPE_ALERT`, `ESCALATED`.

The operational RPC path currently performs:

`IDENTIFIED -> TAGGED -> IN_ARRIVAL_HALL -> ALARMED -> UNDER_RECHECK -> RESOLVED`.

`AT_EXIT` is permitted by the database but the Customs Exit V2 transaction changes an eligible `TAGGED` or `IN_ARRIVAL_HALL` bag directly to `ALARMED`. BHS diversion confirmation is stored separately as `bhs_confirmation_status`; it is not a `DIVERTED` bag status. Final `CLEARED` or `NOT_CLEARED` is a resolution/alarm disposition while the bag becomes `RESOLVED`.

The TypeScript `BagStatus` is a third vocabulary:

`IDENTIFIED`, `TAGGED`, `IN_TRANSIT`, `ALARMED`, `AT_RECHECK`, `RESOLVED`, `LOST`.

`rowStatusToBag` collapses `AT_EXIT` into `IN_TRANSIT`, `ESCAPE_ALERT` and `ESCALATED` into `ALARMED`, and maps every unknown value to `IDENTIFIED`. Therefore the mapping is not lossless and unknown stored data fails open instead of failing validation.

| Required P1 state | Current representation                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `SUSPECT`         | `IDENTIFIED`                                                                                            |
| `DIVERTED`        | `IDENTIFIED` plus `bhs_confirmation_status = CONFIRMED`                                                 |
| `TAGGED`          | `TAGGED`                                                                                                |
| `IN_HALL`         | `IN_ARRIVAL_HALL` / DTO `IN_TRANSIT`                                                                    |
| `AT_EXIT`         | DB value exists / DTO `IN_TRANSIT`; normal RPC skips it                                                 |
| `ALARMED`         | `ALARMED`                                                                                               |
| `RECHECK`         | `UNDER_RECHECK` / DTO `AT_RECHECK`                                                                      |
| `CLEARED`         | bag `RESOLVED`, resolution disposition `CLEARED`                                                        |
| `CONFISCATED`     | no matching service disposition; closest legacy action is `PROHIBITED_ITEM_SEIZED`                      |
| `ESCALATED`       | DB value exists, DTO collapses it to `ALARMED`; alarm escalation does not create the requested bag flow |
| `CLOSED`          | bag `RESOLVED`, alarm `CLOSED`                                                                          |
| `ESCAPE_ALERT`    | DB value exists, DTO collapses it to `ALARMED`; no central transition API was found                     |

## External dependencies that need test doubles

| Dependency            | Current boundary                                                                                               | Phase 1 handling                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Supabase/PostgreSQL   | `supabaseAdmin.server.ts`, `xraySupabase.server.ts`, all server repositories and SQL RPCs                      | Scripted repository/database mock              |
| BHS                   | Semantic HTTP API/service/repository; future adapter interfaces in baseline types; physical transport deferred | BHS receive/acknowledge mock                   |
| HBSS/X-Ray            | `HbssAdapter`, adapter factory, mock adapter, unconfigured Smiths adapter, recall adapter                      | Scan/health/recall mock                        |
| RFID reader           | Credentialed HTTP ingestion and database antenna mapping; no physical reader SDK                               | Event-emitting RFID reader mock                |
| RFID printer          | No production interface exists                                                                                 | Future-boundary printer mock                   |
| GPIO alarm controller | No production interface exists; alarms are software-only                                                       | Future-boundary GPIO mock                      |
| Message bus           | No production interface exists                                                                                 | In-memory publish/subscribe mock               |
| WebSocket/realtime    | `realtimeService.ts` is an intentional disconnected stub; operational clients poll/invalidate React Query      | WebSocket event collector                      |
| System clock          | `Date.now`, `new Date`, and SQL `NOW()` are distributed; some BHS functions already inject `now`               | Deterministic clock and Node fake-timer helper |
| UUIDs                 | Several services/repositories call `randomUUID` directly; BHS service already has an injectable generator      | Deterministic UUID generator                   |

Tests remain offline and do not initialize production Supabase or physical adapters.

## Existing tests to reuse

- `screening-ingestion.test.mjs`: atomic suspect creation, validation, duplicates, conflicts, failure audit.
- `beltcon-bhs-ingestion.test.mjs`: BHS identity, creation, idempotency, acknowledgement, API security.
- `tagging-api.test.mjs`: pending list, authorization, normalization, duplicate EPC, concurrency, audit, missing X-Ray.
- `beltcon-rfid-ingestion.test.mjs`: reader/antenna authority and immutable reads.
- `beltcon-customs-exit-alarm.test.mjs`: durable Customs Exit alarm workflow.
- `beltcon-recheck-workflow.test.mjs`: recheck eligibility, resolution permission, HBSS boundary.
- `xray.test.mjs`: HBSS mock, schemas, X-Ray selection, auditing, and APIs.
- `canonical-access.test.mjs`, `beltcon-security-hardening.test.mjs`: roles, account state, persisted permissions.
- `beltcon-sbts-migration-chain.test.mjs`, `beltcon-sbts-fat-readiness.test.mjs`: migration and readiness conformance.

## Missing test infrastructure before P1

- Shared role/session/request fixtures.
- Shared deterministic bag, reader, BHS, HBSS, tag, and user builders.
- Resettable repository and hardware/integration mocks.
- Deterministic clock/UUID utilities and fake-timer helper.
- Message-bus and realtime collectors.
- Common audit/domain-error assertions.
- Focused P1 and coverage commands.
- A central lifecycle contract and a generic CRUD contract target.

## Missing domain rules and production surfaces

- One canonical, lossless bag status enum and a decision on migration from the three current vocabularies.
- A transition matrix with idempotency, authorization, event, audit, and immutable-field rules.
- Explicit `AT_EXIT`, escape, escalation, final disposition, closure, and reopen semantics.
- A complete strict bag create/update schema.
- Generic exact-identifier reads and `BAG_NOT_FOUND` behavior.
- Archive/delete policy and audit behavior.
- An injectable bag repository/service/API with optimistic concurrency.
- Domain-event publisher and realtime delivery contract.
- Clock and UUID injection across all authoritative mutation paths.
- A resolved product decision on five-tier threat levels: ingestion schemas/database accept 1-5 while `src/routes/settings.threats.tsx` says the product deliberately avoids five-tier severity.

## Recommended implementation order

1. Approve one lifecycle vocabulary and define how existing rows/dispositions map to it.
2. Add strict bag schemas, error codes, domain events, and a pure transition policy.
3. Add a generic injected bag repository and service with exact lookups and optimistic versions.
4. Add one new forward-only migration for status/schema changes and atomic transition/audit RPCs. Do not rewrite migrations `001`-`024`.
5. Route tagging, RFID, alarm, and recheck mutations through the approved policy without weakening their current authorization.
6. Add generic bag API handlers and archive policy.
7. Activate the P1 lifecycle and CRUD TODO tests against those real services.
8. Add a disposable local Postgres/Supabase integration layer, then browser E2E only if a browser framework is approved.

## Exact future production files

Recommended new files:

- `src/domain/bags/bagStatuses.ts`
- `src/domain/bags/bagSchemas.ts`
- `src/domain/bags/bagStateMachine.ts`
- `src/domain/bags/bagEvents.ts`
- `src/domain/bags/bagErrors.ts`
- `src/services/bags/bagRepository.server.ts`
- `src/services/bags/bagService.server.ts`
- `src/services/bags/bagApi.server.ts`
- `src/routes/api.bags.ts`
- `src/routes/api.bags.$bagId.ts`
- `supabase/migrations/025_create_canonical_bag_lifecycle_and_crud.sql`

Recommended modifications after the lifecycle decision:

- `src/types/bag.ts`
- `src/services/bagPersistenceMappings.ts`
- `src/services/bags/taggingService.server.ts`
- `src/services/rfid/rfidReadService.server.ts`
- `src/services/alarms/alarmService.server.ts`
- `src/services/recheck/recheckService.server.ts`

No production file was modified in P1.
