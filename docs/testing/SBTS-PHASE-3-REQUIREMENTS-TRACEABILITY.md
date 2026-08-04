# SBTS Phase 3 requirements traceability

| Requirement                                 | Primary implementation evidence                                | Test evidence                       |
| ------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| BASE_ALWAJH readiness and active queue only | migration 027 session/queue RPCs                               | P3-TAG-001..003, P3-FAT-001/013     |
| Server-controlled session                   | `taggingService.server.ts`, workflow repository, migration 027 | P3-TAG-002/003/021/028              |
| Pre-encoded provisioning                    | identity capture RPC and strict barcode/EPC schemas            | P3-TAG-004/005/009, P3-FAT-002      |
| Print-and-encode provisioning               | reservation/job RPCs and encoder adapter                       | P3-TAG-006..008, P3-FAT-003         |
| Trusted verification                        | verification adapter and attempt table                         | P3-TAG-009..012/022                 |
| Optional IATA LPC                           | LPC schema and update RPC                                      | P3-TAG-013, P3-FAT-004              |
| Bag-photo policy                            | camera/storage adapters, staged photo RPCs                     | P3-TAG-014..016, P3-FAT-005/014/015 |
| Atomic assignment                           | `commit_tagging_session_v1`                                    | P3-TAG-017..021                     |
| Failed-tag isolation                        | failed tag status and retry RPC                                | P3-TAG-008/010..012/022             |
| Replacement history                         | assignments and replacement RPC                                | P3-TAG-023, P3-FAT-009              |
| Queue advancement                           | central transaction plus SQLite evidence gate                  | P3-TAG-024, P3-FAT-019              |
| Wrong-station/operator protection           | get/session mutation bindings                                  | P3-TAG-025, P3-FAT-012              |
| Authorization/RLS                           | permission catalog, strict API, RLS/revokes                    | P3-TAG-026/027/029/033/034          |
| Restart/idempotency                         | operation request responses and durable evidence               | P3-TAG-021/028, P3-FAT-010/017/018  |
| Inventory                                   | import RPC and configuration gate                              | P3-TAG-032                          |
| Metrics                                     | `tagging_metrics_v1`                                           | P3-TAG-031                          |
| Software load                               | simulated adapter load and PostgreSQL concurrency              | P3-TAG-020/030                      |
| Full software FAT                           | station API/HMI, adapters and real PostgreSQL suite            | P3-TAG-035, P3-FAT-001..020         |

All simulated-device evidence is software evidence only. No row in this table certifies physical hardware.
