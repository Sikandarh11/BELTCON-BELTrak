# BELTCON SBTS Baseline Conformance V1

**Review date:** 2026-07-28  
**Build baseline:** `fc90cb5` plus uncommitted Phase 1–11 work  
**Evidence type:** source review and automated mock/static tests; no database or
physical hardware environment was executed.

| ID | Requirement | BELTCON implementation | Files/API/RPC | Test evidence | Result | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| CON-01 | External BHS BagID | Ten-character printable BHS BagID is preserved; ETB fallback is rejected | baseline schemas; migration 016 | baseline and BHS ingestion tests | PASS | Database constraint not executed |
| CON-02 | Message 2001 | Strict semantic 2001 payload and equipment-key API | BHS API; migration 017 | BHS ingestion tests | PASS | No physical transport |
| CON-03 | Message 2002 | Semantic acknowledgement only after durable processing result | baseline mappers; BHS service | BHS baseline/ingestion tests | PASS | Wire bytes await SAT |
| CON-04 | A/R/T/N/? mapping | A→ACCEPT; remaining values are Tagging eligible | baseline mappers | BHS baseline/ingestion tests | PASS | Runtime persistence not executed |
| CON-05 | Tagging Queue | Server-backed identified-bag queue with no Zustand fallback | tagging API/client/page | tagging API tests | PARTIAL | Database refresh needs FAT |
| CON-06 | RFID barcode assignment | Distinct barcode, EPC, optional IATA LPC, version and uniqueness checks | migration 018; tagging service | tag assignment/tagging tests | PARTIAL | RPC not applied |
| CON-07 | Reclaim detection | Reader/antenna derives `RECLAIM` server-side | migration 019; RFID service | RFID ingestion tests | PARTIAL | No reader hardware |
| CON-08 | Customs Exit detection | RFID V2 creates one active Customs Exit alarm | migration 020; alarm service | Customs Exit tests | PARTIAL | PostgreSQL uniqueness not executed |
| CON-09 | Alarm acknowledgement/escalation | Exact server permissions, versioned actions and reason validation | alarm API/service | Customs Exit tests | PARTIAL | Runtime multi-session not executed |
| CON-10 | Send to Recheck | Versioned alarm/bag transition without automatic recall/resolution | alarm service; migration 020 | Customs Exit tests | PARTIAL | RPC not applied |
| CON-11 | RFID lookup | Server Recheck lookup uses barcode/EPC, not client case selection | recheck API/service | Recheck workflow tests | PARTIAL | Database path not executed |
| CON-12 | BHS BagID retrieval | Server retrieves BHS BagID from stored bag for recall | recheck service; migration 021 | Recheck tests | PARTIAL | Database path not executed |
| CON-13 | HBSS recall | Server-selected simulated/disabled adapter and persisted request | HBSS adapters; Recheck service | Recheck tests | PASS (simulation) | Physical RS-232 is SAT REQUIRED |
| CON-14 | Manual inspection | Unavailable image/recall does not block approved resolution | Recheck page and service | X-ray/Recheck tests | PASS | SOP validation is SAT REQUIRED |
| CON-15 | Final resolution | Atomic resolution, bag resolve and alarm close RPC | migration 021; Recheck service | Recheck workflow tests | PARTIAL | PostgreSQL transaction not executed |
| CON-16 | Alarm closure | Close action/disposition and durable audit are emitted with resolution | migration 021 | Recheck workflow tests | PARTIAL | RPC not applied |
| CON-17 | Audit history | Server audit read model, filters and guarded export | audit API/service; migration 022 | read-model tests | PARTIAL | Complete runtime timeline not observed |
| CON-18 | Authorization | Active profile plus persisted exact permissions; workspace ignored | authorization service; migration 023 | canonical/security tests | PASS (mock/static) | Matrix must be applied to test DB |
| CON-19 | Final-resolution permission | `bag.resolve` required for resolution; `bag.recheck` alone is insufficient | Recheck API/page | Recheck workflow test | PASS | Requires role-matrix FAT evidence |
| CON-20 | Simulator versus physical integration | Simulator explicitly labelled; physical flags disabled | baseline feature flags/adapters | baseline and architecture tests | PASS | Physical tests are SAT REQUIRED |

## Result interpretation

`PASS` means the reviewed semantic contract or simulation behavior is covered
by automated evidence. `PARTIAL` means the implementation and static/mock tests
exist but a disposable PostgreSQL execution was unavailable. `SAT REQUIRED`
means physical airport hardware, transport, or customer process evidence is
required and is not implied by simulator results.
