# BELTCON SBTS Factory Acceptance Test V1

## Document control

| Field | Value |
| --- | --- |
| Product | BELTCON Suspect Bag Tracking System |
| Version | SBTS Baseline V1 |
| Build/commit | `fc90cb5` plus approved working-tree build under test |
| Test environment | Dedicated disposable non-production environment only |
| Date | ____________________ |
| Tester | ____________________ |
| Witness | ____________________ |
| Status | NOT EXECUTED |

## Preconditions

1. Build, typecheck, and automated tests have passed for the build under test.
2. Migrations 001–023 have been applied sequentially to an empty disposable
   database and recorded in the evidence pack.
3. Test-only accounts exist for the five canonical roles and have the approved
   persisted permission matrix.
4. Simulated BHS, RFID, and HBSS features are enabled only in the test
   environment. Physical adapters remain disabled.
5. Reader `RDR-TEST-01` is enabled with ports 1=`RECLAIM`,
   2=`CUSTOMS_EXIT`, and 3=`RECHECK`.
6. Test-data reset uses an approved disposable-database reset. Never use a
   shared airport or production database.

Primary data: BHS source `BELTCON_BHS_TEST_SOURCE`; BHS BagID `1234567890`;
line `01`; evaluation `R`; barcode `TAG-000001`; EPC `EPC-000001`; IATA LPC
`5127439982`. Do not record passwords in this document or evidence.

## FAT cases

| FAT ID | Requirement and detailed steps | Expected result | Actual result | Pass/Fail | Evidence / Tester / Witness / Notes |
| --- | --- | --- | --- | --- | --- |
| FAT-01 | Authenticate each canonical role; try workspace changes and direct protected URLs. | Active profiles load only persisted permissions; workspace never grants access. | __________ | __________ | __________ |
| FAT-02 | Submit valid BHS 2001 `R` message using the equipment credential. | Validated event, preserved BagID, eligible identified bag, semantic 2002 after commit. | __________ | __________ | __________ |
| FAT-03 | Repeat FAT-02 with `A`, then with `T`, `N`, and `?`. | `A` stores no queue bag; other values produce eligible minimal bags. | __________ | __________ | __________ |
| FAT-04 | Retry identical BHS message, then reuse the BagID with changed line/evaluation. | Duplicate returns same result; changed payload is controlled conflict with no overwrite. | __________ | __________ | __________ |
| FAT-05 | Refresh Tagging Queue after FAT-02. | Server-backed queue shows BagID, line and evaluation; missing optional fields do not break it. | __________ | __________ | __________ |
| FAT-06 | Assign barcode, EPC and IATA LPC with the expected version. Repeat with duplicate EPC/barcode, invalid LPC, stale version and later lifecycle bag. | One durable `TAGGED` association; failures do not partially assign or display false success. | __________ | __________ | __________ |
| FAT-07 | Submit RFID read through port 1, omit/alter any browser zone field. | Server maps port to `RECLAIM`; event links to bag and moves lifecycle forward only. | __________ | __________ | __________ |
| FAT-08 | Submit RFID read through port 2, retry it, then submit a new exit read and concurrent equivalent reads. | Exactly one active Customs Exit alarm; no duplicate alarm or lifecycle corruption. | __________ | __________ | __________ |
| FAT-09 | Submit unassigned EPC and disabled/unknown reader or antenna cases. | Diagnostic event/result as applicable; no bag, alarm or automatic association. | __________ | __________ | __________ |
| FAT-10 | Acknowledge and escalate an alarm with valid/stale/unauthorized actors and blank reason. | Versioned actions, actor/audit records, controlled denial/conflict. | __________ | __________ | __________ |
| FAT-11 | Send active alarm to Recheck, then repeat/stale/unauthorized action. | Recheck state and active alarm retained; no recall/resolution or partial state. | __________ | __________ | __________ |
| FAT-12 | Scan `TAG-000001` at Recheck and try unknown/fuzzy input. | Exact server lookup returns correct bag, alarm and BHS BagID; no client-selected authority. | __________ | __________ | __________ |
| FAT-13 | Request simulated HBSS recall; try missing/invalid BagID, unavailable adapter, duplicate key and unauthorized actor. | Durable attempt with `SIMULATED`/safe failure; manual inspection remains possible; no physical communication. | __________ | __________ | __________ |
| FAT-14 | Resolve a Recheck case as `CLEARED`, then a second case as `NOT_CLEARED` with required notes. | Atomic resolution, resolved bag, closed alarm, action/audit, preserved tag/EPC. | __________ | __________ | __________ |
| FAT-15 | Exercise wrong versions, wrong state, closed case and duplicate final resolution. | No partial close/resolve; controlled conflict or idempotent result. | __________ | __________ | __________ |
| FAT-16 | Inspect audit timeline and reports for the completed cases. | Correct server timestamps, actor, IDs and dispositions; no passwords, tokens or keys. | __________ | __________ | __________ |
| FAT-17 | View and edit reader configuration with read/manage and unauthorized accounts. | Paginated/read-safe view; versioned, reasoned server mutation only. | __________ | __________ | __________ |
| FAT-18 | Manage users/roles: attempt self-escalation, final-admin removal, suspension and password reset. | Exact authorization, reason/audit, final-admin and self-escalation safeguards. | __________ | __________ | __________ |
| FAT-19 | Export reports and audit using formula-like values and excessive date range. | Permission/filter/date-range controls, CSV escaping and safe metadata. | __________ | __________ | __________ |
| FAT-20 | Refresh each queue after every mutation and use two independent API clients for stale versions. | Server state persists; stale write is rejected; UI refetches safely. | __________ | __________ | __________ |
| FAT-21 | Logout then sign in as another role. | Session and user-scoped cache are cleared; no prior protected data is reused. | __________ | __________ | __________ |
| FAT-22 | Verify simulator labels and disabled physical flags. | All activity is labelled simulated/software-only; no physical success claim. | __________ | __________ | __________ |
| FAT-23 | Record build, migration output, test output, screenshots, exports, and database query evidence. | Complete traceable evidence pack with deviations and retest results. | __________ | __________ | __________ |

## Exit criteria

FAT is ready to execute only after the disposable-database migration chain has
been applied. It passes only when all applicable cases pass, no Critical/High
baseline defect remains, and every deviation has an owner, target date, and
retest record. Simulator cases do not constitute physical airport acceptance.
