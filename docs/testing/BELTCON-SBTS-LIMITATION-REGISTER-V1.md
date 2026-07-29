# BELTCON SBTS Baseline V1 Limitation Register

| ID | Description | Category / Severity | Current behavior and impact | Workaround / required fix | Required before | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LIM-01 | Migrations 001–023 were not applied to a disposable database in this review. | Verification / High | RPC syntax, dependencies, transaction and index behavior are static-only. | Provision isolated database; apply chain and capture SQL evidence. | FAT | __________ | Open |
| LIM-02 | Profinet BHS adapter is disabled. | Integration / High | No physical message 2001/2002 transport. | Vendor-approved adapter, framing and SAT evidence. | SAT | __________ | Open |
| LIM-03 | Physical RFID/LLRP adapter is disabled. | Integration / High | No physical reader event is received. | Implement contracted adapter and validate reader security/mapping. | SAT | __________ | Open |
| LIM-04 | RS-232 HBSS adapter is an unavailable placeholder. | Integration / High | Only simulated recall is available. | Vendor ICD, serial adapter and physical recall validation. | SAT | __________ | Open |
| LIM-05 | Light/buzzer output is not implemented. | Hardware / High | Alarm remains software-only. | Contracted safe output interface and SAT wiring test. | SAT | __________ | Open |
| LIM-06 | Cross-browser realtime is not verified. | Operations / Medium | Pages use query invalidation/polling/refetch policy. | Validate realtime or formalize refresh SLA. | FAT | __________ | Open |
| LIM-07 | Multi-session concurrency is mock/static only. | Data integrity / High | PostgreSQL locking/version behavior is not evidenced. | Two-client test against disposable database. | FAT | __________ | Open |
| LIM-08 | Reader heartbeat is a stored/read-model state, not hardware-health proof. | Operations / Medium | Online/degraded/offline meaning depends on integration feed. | Add contracted heartbeat transport and monitoring. | SAT | __________ | Open |
| LIM-09 | Internal X-ray viewer is optional. | Workflow / Low | Manual inspection continues when image/recall is unavailable. | Validate airport HBSS/X-ray workflow. | SAT | __________ | Accepted |
| LIM-10 | HBSS adapter is simulation only. | Integration / High | Result never asserts physical acknowledgement. | Complete vendor integration and SAT. | SAT | __________ | Open |
| LIM-11 | MFA is deferred. | Security / Medium | Password/session protections only. | Implement and test MFA policy. | Production | __________ | Deferred |
| LIM-12 | SSO/SCIM is deferred. | Identity / Medium | Local Supabase identity administration remains primary. | Implement enterprise identity integration. | Production | __________ | Deferred |
| LIM-13 | Tag replacement history is deferred. | Functional / Medium | Baseline supports one active association, not full replacement chain. | Define audited replacement process. | Production if required | __________ | Deferred |
| LIM-14 | Multi-airport tenancy is deferred. | Architecture / Medium | Baseline is single deployment/site oriented. | Introduce tenancy isolation after V1. | Production for multi-site | __________ | Deferred |
| LIM-15 | Notification outbox is deferred. | Operations / Medium | No durable notification dispatch/retry service. | Add outbox and delivery monitoring. | Production | __________ | Deferred |
| LIM-16 | Raw RFID partitioning is deferred. | Scale / Low | Retention/partition strategy is not implemented. | Establish retention and partition plan. | Production | __________ | Deferred |
| LIM-17 | Backup/restore, HA/failover and power recovery are untested. | Resilience / High | No recovery evidence. | Execute approved resilience plan. | SAT / Production | __________ | Open |
| LIM-18 | Load/performance testing is not performed. | Performance / Medium | No airport-throughput claim is supported. | Define workload and execute load test. | Production | __________ | Open |
| LIM-19 | Formal penetration test is not performed. | Security / High | Code review and tests are not a penetration test. | Independent security assessment and remediation. | Production | __________ | Open |
| LIM-20 | Legacy pre-BELTCON branding remains in pre-existing source, tests, migrations, and UI. | Product quality / Medium | The Phase 11 documents use BELTCON only, but repository-wide rebrand is incomplete. | Controlled rebrand with migration/audit compatibility plan. | Demo if customer-facing | __________ | Open |
| LIM-21 | Full-project lint exceeds the bounded 300-second verification window. | Tooling / Low | Focused lint passes; whole-tree lint emits no diagnostic before timeout. | Profile lint scope/performance without changing baseline behavior. | Production CI | __________ | Open |
