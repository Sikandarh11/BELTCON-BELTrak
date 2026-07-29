# BELTCON SBTS HBSS/BHS Correlation and Tagging Readiness V1

## Problem and canonical identity

HBSS suspect detection and BHS message 2001 describe the same physical bag. In the single-airport BELTCON SBTS V1 deployment, one valid 10-character BHS BagID maps to one canonical `bags.id`. The BHS BagID is a string: leading zeros are preserved and the internal `ETB-*` display ID is never copied into it.

`source_system` remains on integration events for provenance and source-scoped idempotency. It is not part of canonical bag identity.

## Two-stage readiness

The operational lifecycle remains `IDENTIFIED` while a separate readiness state changes:

| Stage                                            | `bhs_confirmation_status`   | Tag assignment                             |
| ------------------------------------------------ | --------------------------- | ------------------------------------------ |
| HBSS suspect detected                            | `AWAITING_BHS_CONFIRMATION` | Disabled                                   |
| BHS diversion confirmed by semantic message 2001 | `CONFIRMED`                 | Enabled only for an otherwise eligible bag |

HBSS stores the received time, station, raw/normalized screening evaluation, threat details, optional passenger/flight fields, and X-ray references. BHS stores the line, confirmation event and timestamps. A normal suspect simulator event permits only `R`, `T`, `N`, or `?`; it defaults to `R`. `A`/Accept is not taggable.

## Arrival orders and idempotency

**HBSS first:** HBSS creates one canonical bag in `AWAITING_BHS_CONFIRMATION`. The case is visible in the BHS pending-confirmation list and in Tagging Station, but the RFID form is disabled. BHS confirmation later finds the same `bags.id`, confirms it, and returns semantic acknowledgement 2002.

**BHS first:** message 2001 creates a confirmed minimal canonical bag. A later HBSS event finds that same BHS BagID, enriches its screening/X-ray data, and must not downgrade `CONFIRMED`.

Exact HBSS retries are source/event-id idempotent. Exact BHS retries are source/fingerprint idempotent. Neither creates a second bag, scan, confirmation, or version increment.

## Simulator behavior

The BELTCON HBSS Simulator sends normalized suspect events through the server ingestion service. It does not create a bag in the browser.

The default BELTCON BHS Simulator view lists only server-loaded pending diversions. The BHS BagID and screening evaluation are read-only; the operator supplies the two-character line ID and trigger is fixed to `1`. The server derives the BagID, evaluation, source identity and actor, then invokes the same BHS service used by the real integration endpoint. The optional Raw BHS Message Test is isolated as an advanced BHS-first test mode.

Message 2001 means **BHS routing/diversion confirmed**. It does not claim the bag physically arrived at a tagging lane. A future physical-tagging-lane arrival confirmation can be added after the actual interface specification is available.

## Tagging eligibility and security

`canAssignTag` is calculated server-side from the lifecycle, confirmation status, screening evaluation, EPC and RFID barcode. The UI reflects it, but the authoritative RFID transaction independently returns `TAG_ASSIGNMENT_BHS_CONFIRMATION_REQUIRED` when confirmation is absent.

HBSS and BHS simulator APIs require an authenticated active session, persisted `simulator.use`, an enabled simulator feature, and non-production defaults. Tag assignment requires persisted `bag.tag`. Workspace mode, browser state, feature flags and hidden buttons do not grant authority. Browser code receives no integration or service-role credential.

## Duplicate repair and conflicts

The migration does not automatically delete historical duplicates. `beltcon_bhs_duplicate_identity_report_v1` reports them. The service-role-only `repair_beltcon_safe_bhs_duplicate_v1` procedure may merge exactly two safe records only when both are `IDENTIFIED`, untagged, without alarm/recheck/resolution/RFID events, and with no line/evaluation conflict. It deterministically prefers a confirmed row, repoints screening-event and X-ray references under a transaction-local repair guard, verifies the repoint, then deletes the duplicate and audits `BAG_IDENTITY_MERGED`.

Duplicates with conflicting EPC/barcode/evaluation/line, active later lifecycle data, alarms, recheck, resolutions, or RFID events are reported as `BAG_IDENTITY_CONFLICT` for manual review; no row is deleted. New canonical duplicate creation is prevented by a serialized BHS BagID trigger and readiness-managed unique index. A full legacy-wide unique index remains deferred until the report is clean, so migration deployment does not fail blindly on unresolved data.

## Audit and query refresh

Durable audit events include `HBSS_SUSPECT_DETECTED`, `BAG_AWAITING_BHS_CONFIRMATION`, `BHS_DIVERSION_CONFIRMED`, `BAG_READY_FOR_TAGGING`, `BAG_IDENTITY_MERGED`, `BAG_IDENTITY_CONFLICT`, and `TAG_ASSIGNMENT_BLOCKED_BHS_CONFIRMATION_REQUIRED`. They contain safe IDs, evaluation, line, status change, request ID and actor/source context; never credentials or uncontrolled raw payloads.

HBSS submit invalidates pending BHS confirmations, Tagging Queue, bag, RFID, X-ray and audit queries. BHS confirmation invalidates pending confirmations, Tagging Queue, bag detail/list, BHS integration and audit queries. Users/roles/settings caches are not invalidated.
