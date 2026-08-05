# SBTS Phase 2 requirements traceability

Status date: 2026-08-03. `VERIFIED` means exercised by the named software test. It does not imply vendor or physical-hardware acceptance.

| Requirement ID | Source                            | Requirement                                             | Implementation                           | Test ID                            | Result                                  | Limitation                                                       |
| -------------- | --------------------------------- | ------------------------------------------------------- | ---------------------------------------- | ---------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| P2-BHS-01      | Supplied BHS requirement extract  | Strict semantic message 2001 validation                 | BHS schemas/service                      | P2-BHS-001–003                     | VERIFIED                                | Vendor telegram mapping pending                                  |
| P2-BHS-02      | Supplied BHS requirement extract  | Two-character LineID                                    | BHS schema and SQL constraints           | P2-BHS-003, P2-DB-003              | VERIFIED                                | Physical PLC mapping pending                                     |
| P2-BHS-03      | Supplied BHS requirement extract  | Exact ten-character BagID                               | `BhsUidSchema`, database constraints     | P2-BHS-003, P2-DB-011              | VERIFIED                                | Vendor character repertoire still provisional                    |
| P2-BHS-04      | Internal application contract     | A/R/T/N/? evaluation semantics                          | canonical BHS RPC                        | P2-BHS-001–002, P2-DB-004–005      | VERIFIED                                | Final vendor meanings pending ICD                                |
| P2-BHS-05      | Supplied BHS requirement extract  | Optional message 2002                                   | semantic encoder, station transport      | P2-STATION-004–006                 | VERIFIED BY SOFTWARE                    | Ack value/policy pending vendor                                  |
| P2-BHS-06      |  design extract            | Two-position queue and no overwrite                     | SQLite station inbox                     | P2-STATION-007–010, FAT-SW-003–004 | VERIFIED                                | Physical conveyor timing pending                                 |
| P2-BHS-07      | Software architecture             | Durable station buffering/restart                       | SQLite station inbox/agent               | P2-STATION-013–016, P2-DB-028      | VERIFIED                                | Host packaging not airport-validated                             |
| P2-BHS-08      | Software architecture             | Trusted central synchronization                         | station wrapper RPC/migration 026        | P2-DB-018, FAT-SW-006              | VERIFIED                                | Deployment network pending                                       |
| P2-HBSS-01     | Supplied HBSS requirement extract | Exact RFID-to-BagID lookup                              | Recheck repository exact equality        | P2-HBSS-006–008, FAT-SW-010        | VERIFIED                                | Physical scanner pending                                         |
| P2-HBSS-02     | Supplied HBSS requirement extract | Serial settings and framing profiles                    | station serial config/codecs             | P2-SERIAL-002–006                  | VERIFIED BY SOFTWARE                    | Final framing pending ICD                                        |
| P2-HBSS-03     | Supplied HBSS requirement extract | Five-second error handling                              | Recheck station agent                    | P2-SERIAL-010–012, FAT-SW-012      | VERIFIED BY SOFTWARE                    | Physical COM behavior pending                                    |
| P2-HBSS-04     | Supplied HBSS requirement extract | Request status separate from image status               | `REQUEST_SENT` state and X-Ray selection | P2-SERIAL-013–014, P2-DB-019       | VERIFIED                                | No HBSS response telegram is assumed                             |
| P2-HBSS-05     | Internal application contract     | Exact X-Ray/bag correlation                             | trigger and ingestion RPC                | P2-DB-011–012, FAT-SW-013          | VERIFIED                                | Smiths image contract unavailable                                |
| P2-SEC-01      | Security requirement              | Trusted source/site identity                            | credential registry and station wrapper  | P2-BHS-014, P2-HBSS-005, P2-DB-018 | VERIFIED                                | Multi-site row reads are not modeled in V1                       |
| P2-SEC-02      | Security requirement              | Direct authenticated writes blocked                     | migration 025 grants/RLS                 | P2-DB-020                          | VERIFIED                                | Service roles remain privileged by design                        |
| P2-SEC-03      | Security requirement              | Audit append-only                                       | service-role revoke plus RLS             | P2-DB-022, FAT-SW-017              | VERIFIED                                | Database owner remains an administrative trust boundary          |
| P2-SEC-04      | Security requirement              | Simulator disabled in production                        | environment/security guard               | P2-STATION-017–018, P2-SERIAL-019  | VERIFIED                                | Production deployment configuration pending                      |
| P2-DATA-01     | Software architecture             | Idempotent canonical BHS bag                            | advisory lock and unique identity        | P2-DB-006–008, P2-DB-027           | VERIFIED                                | None in software scope                                           |
| P2-DATA-02     | Software architecture             | BHS-first/HBSS-first convergence                        | canonical BHS UID and RPC locks          | P2-DB-013–015, FAT-SW-019          | VERIFIED                                | None in software scope                                           |
| P2-DATA-03     | Security requirement              | Cross-bag image protection                              | correlation/immutability triggers        | P2-DB-010–012                      | VERIFIED                                | None in software scope                                           |
| P2-DATA-04     | Software architecture             | Transaction rollback                                    | SECURITY DEFINER RPC transactions        | P2-DB-023                          | VERIFIED                                | Process/network fault matrix remains partly simulated            |
| P2-DATA-05     | Internal application contract     | External scan identity immutable and source-scoped      | unique index and trigger                 | P2-DB-010–012                      | VERIFIED                                | Vendor scan-ID definition pending                                |
| P2-DATA-06     |  design extract            | Base readiness does not require local image/threat/IATA | `BASE_ALWAJH` database policy            | P2-DB-016, FAT-SW-002/014          | VERIFIED                                | Enhanced policy is explicit opt-in                               |
| P2-DATA-07     | Internal application contract     | Tag identity unique and immutable                       | `tags` table and tag RPC                 | P2-DB-017, FAT-SW-009              | VERIFIED                                | RFID hardware pending                                            |
| P2-OPS-01      | Software architecture             | Fresh migrations 001–026                                | disposable PostgreSQL harness            | P2-DB-002–003                      | VERIFIED                                | PostgreSQL 17 software environment only                          |
| P2-OPS-02      | Software architecture             | Upgrade 024→025→026                                     | ordered transactional migration runner   | P2-DB-025                          | VERIFIED                                | Legacy NULL BHS UID is not representable in migration 024 schema |
| P2-OPS-03      | Software architecture             | Standalone durable station process                      | Node smoke host + SQLite                 | P2-DB-028                          | VERIFIED BY LOCAL PROCESS TEST          | Airport packaging/service manager pending                        |
| P2-OPS-04      | FAT requirement                   | Twenty-scenario software FAT                            | combined station/DB harness              | FAT-SW-001–020                     | VERIFIED / SIMULATED ONLY as classified | No physical hardware/vendor workstation                          |
| P2-OPS-05      | CI requirement                    | Automated software gate                                 | `.github/workflows/phase2-software.yml`  | P2-DB-029                          | VERIFIED BY CONFIGURATION               | First hosted CI run pending                                      |
| P2-OPS-06      | Internal application contract     | Traceability and limitations complete                   | Phase 2 documents                        | P2-DB-030                          | VERIFIED                                | Update when final ICDs arrive                                    |

## Required database test IDs

| Test ID   | Evidence                                                  | Result                                  |
| --------- | --------------------------------------------------------- | --------------------------------------- |
| P2-DB-001 | Target validation, redaction, live write/read-only probes | PASS                                    |
| P2-DB-002 | Ordered migrations 001–026                                | PASS                                    |
| P2-DB-003 | Catalog-deployed objects and contracts                    | PASS                                    |
| P2-DB-004 | BHS ACCEPT                                                | PASS                                    |
| P2-DB-005 | BHS non-ACCEPT                                            | PASS                                    |
| P2-DB-006 | Sequential duplicate                                      | PASS                                    |
| P2-DB-007 | Concurrent duplicate                                      | PASS                                    |
| P2-DB-008 | Decision conflict                                         | PASS                                    |
| P2-DB-009 | HBSS valid ingestion                                      | PASS                                    |
| P2-DB-010 | External identity conflict                                | PASS                                    |
| P2-DB-011 | Exact BHS UID correlation                                 | PASS                                    |
| P2-DB-012 | Cross-bag protection                                      | PASS                                    |
| P2-DB-013 | BHS-first convergence                                     | PASS                                    |
| P2-DB-014 | HBSS-first convergence                                    | PASS                                    |
| P2-DB-015 | Concurrent convergence                                    | PASS                                    |
| P2-DB-016 | Base/enhanced tagging readiness                           | PASS                                    |
| P2-DB-017 | Tag assignment/uniqueness/retry                           | PASS                                    |
| P2-DB-018 | Station metadata/binding                                  | PASS                                    |
| P2-DB-019 | Recall durability/status separation                       | PASS                                    |
| P2-DB-020 | Real-role direct-write blocking                           | PASS                                    |
| P2-DB-021 | Station/site delivery takeover blocking                   | PASS; full multi-site reads not modeled |
| P2-DB-022 | Audit immutability                                        | PASS                                    |
| P2-DB-023 | Transaction rollback                                      | PASS                                    |
| P2-DB-024 | Response-loss retry                                       | PASS                                    |
| P2-DB-025 | Upgrade 024→025→026                                       | PASS                                    |
| P2-DB-026 | Unreachable/read-only recovery gates                      | PASS                                    |
| P2-DB-027 | Real concurrent clients/load                              | PASS                                    |
| P2-DB-028 | Standalone station-host smoke                             | PASS                                    |
| P2-DB-029 | Software FAT scenarios                                    | PASS                                    |
| P2-DB-030 | Traceability/limitation registers                         | PASS                                    |

## Software FAT IDs

| Test ID    | Scenario                     | Classification                                                      |
| ---------- | ---------------------------- | ------------------------------------------------------------------- |
| FAT-SW-001 | Valid ACCEPT                 | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-002 | Valid suspect bag            | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-003 | Two-bag queue                | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-004 | Queue overflow               | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-005 | Duplicate BHS message        | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-006 | Central unavailable/recovery | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-007 | Station restart              | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-008 | Manual jam clear             | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-009 | Tag assignment               | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-010 | Exact recheck lookup         | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-011 | Virtual HBSS recall          | SIMULATED ONLY                                                      |
| FAT-SW-012 | Virtual serial timeout       | SIMULATED ONLY                                                      |
| FAT-SW-013 | Wrong BHS UID image          | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-014 | Mock image unavailable       | SIMULATED ONLY                                                      |
| FAT-SW-015 | Decision conflict            | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-016 | Cross-site station binding   | PASS — VERIFIED BY SOFTWARE TEST; full multi-site reads not modeled |
| FAT-SW-017 | Audit protection             | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-018 | Response-loss retry          | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-019 | Concurrent BHS/HBSS          | PASS — VERIFIED BY SOFTWARE TEST                                    |
| FAT-SW-020 | Full software journey        | SIMULATED ONLY                                                      |

## Source status

- BLOCKER: no final BHS vendor ICD, GSD file, final HBSS framing document, response telegram definition, or Smiths image-transfer/authentication contract is present in this repository.
- VERIFIED: repository-owned semantic contracts and the supplied requirement extracts were used; no vendor-specific field or acknowledgement was added.
- UNKNOWN: the existing ADR’s older `ACKNOWLEDGED`/`COMPLETED` recall vocabulary conflicts with the newer supplied requirement that defines no response telegram. Migration 025 now conservatively persists `REQUEST_SENT` only; the ADR should be formally superseded when the vendor contract arrives.
