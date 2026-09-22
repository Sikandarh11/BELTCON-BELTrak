# SBTS Phase 3 tagging software report

## Scope and classification

This phase implements a software-only tagging workflow. It verifies PostgreSQL transactions, server APIs, station persistence, HMI state, production interfaces, unavailable physical placeholders, and software simulators. It does **not** claim physical RFID, camera, printer/encoder, conveyor, or vendor SDK interoperability.

## Architecture

```text
BHS 2001 -> station SQLite queue (position 1 / position 2)
                         |
                         v
             central queue correlation
                         |
                         v
 server tagging session bound to Site + Station + Queue + Bag + BHS UID + Operator
                         |
       +-----------------+------------------+
       |                                    |
 PRE_ENCODED_TAG                    PRINT_AND_ENCODE
 barcode + expected EPC             barcode -> EPC reservation
       |                             -> encode job/adapter
       +-----------------+------------------+
                         v
            trusted read-back verification
                         |
                 optional IATA LPC
                         |
        camera -> staging storage -> photo metadata
                         |
                         v
 PostgreSQL commit: tag + active assignment + bag TAGGED + central queue advance + audit
                         |
             storage promote/finalize (retryable)
                         |
                         v
 local SQLite receives central session + assignment evidence, then dispatches/advances
```

Browser requests cannot supply station/site identity, provisioning mode, adapter type, storage key, or a verification result. These are derived from validated server process configuration and trusted adapter results.

## Implementation inventory

1. **Files created:** migration 027; workflow types, schemas, repository, RFID/camera/storage adapters and factory; P3 application, PostgreSQL and FAT suites; Phase 3 CI and documentation.
2. **Files modified:** station configuration, station SQLite repository/agent/API/HMI, tagging service/API/route, permission catalog, environment example, scripts, migration-chain and existing station/tagging tests.
3. **Migration added:** `027_complete_tagging_station_workflow.sql`, forward-only after 026.
4. **Tagging-session architecture:** durable state machine with immutable bag/BHS/station/operator/mode identity and optimistic versions.
5. **RFID adapters:** simulated and unavailable physical implementations plus vendor-neutral shells; keyboard-wedge input is transport-neutral.
6. **Provisioning modes:** `PRE_ENCODED_TAG` and `PRINT_AND_ENCODE`, selected only by trusted configuration.
7. **EPC reservation:** central no-reuse reservation state machine with advisory locking and unique constraints.
8. **Verification:** stable-read evidence is adapter-produced and stored; browser cannot declare success.
9. **Failed tags:** stored as `FAILED`; never assigned; retry clears the session identity and requires a new tag.
10. **Optional IATA:** nullable; exact ten-digit compatibility format from the existing repository is preserved, including leading zeros.
11. **Bag photos:** JPEG/PNG signature, size, checksum, dimensions, bag/session/station binding, retakes and reasoned override.
12. **Photo storage:** stage before commit, promote after commit, idempotent database finalize; promotion failures remain staged and retryable.
13. **Atomic assignment:** one PostgreSQL function commits the tag, assignment history, bag lifecycle, central queue and audit.
14. **Replacement:** active assignment becomes `REPLACED`; new assignment version becomes `ACTIVE`; old tag is retained.
15. **Queue advancement:** central queue advances in commit; local queue advances only with central session and assignment evidence.
16. **Security:** exact P3 permissions, strict request schemas, trusted station identity, operator binding, sanitized device results and closed legacy direct assignment endpoints.
17. **RLS:** workflow tables revoke browser roles; mutation RPCs are service-role only; evidence history has append-only triggers.
18. **PostgreSQL:** fresh 001-027 and upgrade-from-026 paths are executable on a disposable real PostgreSQL target.
19. **Concurrency:** row/advisory locks plus unique indexes cover sessions, EPCs, active assignments and commit request IDs.
20. **Restart/recovery:** sessions, jobs, verification, photos and idempotency responses are durable; browser state is not authoritative.
21. **Simulator:** deterministic scan, encoder, verifier, camera and storage behavior with failure injection; trusted enablement is required.
22. **Software FAT:** P3-FAT-001 through P3-FAT-020 are registered and explicitly classify simulated hardware.
23. **Tests registered:** P3-TAG-001 through P3-TAG-035, 26 real PostgreSQL cases, and P3-FAT-001 through P3-FAT-020.
24. **Tests executed:** see the final command evidence in the delivery response.
25. **Passing tests:** see the final command evidence in the delivery response.
26. **Failing tests:** see the final command evidence in the delivery response.
27. **Skipped/TODO:** physical hardware tests remain pending, not represented as software passes.
28. **Production defects found:** local browser completion advanced the queue without central commit; legacy APIs bypassed verification; EPC/barcode normalization was unsuitable; no session/photo/history model; operator binding was incomplete; photo activation crossed a storage transaction boundary.
29. **Production defects fixed:** those software defects are closed by the session workflow, strict validators, evidence-gated local completion, closed legacy endpoints, mutation binding, and staged/finalized photos.
30. **Compatibility risks:** old clients calling direct encode/assign now receive `TAGGING_SESSION_REQUIRED`; existing legacy tags are backfilled with `LEGACY` site/station history; existing non-hex legacy EPCs remain preserved but cannot be newly created through P3.
31. **Vendor blockers:** supplier barcode specification, EPC allocation/encoding layout, final printer/encoder SDK, final RFID reader verification contract, and approved label template.
32. **Hardware blockers:** physical reader/antenna performance, printer encode/read-back, camera capture/quality, conveyor release interlock, target workstation drivers and network/TLS.
33. **Commands:** `typecheck`, full/application tagging tests, station tests, real PostgreSQL tests, tagging FAT, build, lint, formatting and diff checks are the required gate.
34. **Traceability:** see `SBTS-PHASE-3-REQUIREMENTS-TRACEABILITY.md`.
35. **Final status:** assigned only after the complete command gate; hardware remains pending independently.

## Operational boundary

The software commit does not prove that a physical conveyor released a bag or that a physical RFID label was encoded/read. The Phase 2 watchlist acknowledgement/approved-release boundary and final BHS vendor ICD remain separate controlled dependencies.
