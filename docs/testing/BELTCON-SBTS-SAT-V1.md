# BELTCON SBTS Site Acceptance Test V1

## Document control

| Field | Value |
| --- | --- |
| Product | BELTCON Suspect Bag Tracking System |
| Airport/site | ____________________ |
| Deployment build | ____________________ |
| Network environment | ____________________ |
| Hardware inventory | ____________________ |
| Test date | ____________________ |
| BELTCON representatives | ____________________ |
| Airport representatives | ____________________ |
| BHS vendor representative | ____________________ |
| HBSS vendor representative | ____________________ |
| Customs representative | ____________________ |
| Status | NOT EXECUTED |

All physical cases begin as `NOT EXECUTED`, `BLOCKED`, or `NOT APPLICABLE`.
They must never be pre-marked PASS from simulator evidence.

| SAT ID | Site acceptance area | Required evidence / expected outcome | Initial status |
| --- | --- | --- | --- |
| SAT-01 | Server and database installation | Approved installation, migration log, health and rollback evidence | NOT EXECUTED |
| SAT-02 | Backup, restore, HA and power recovery | Approved backup/restore and contracted failover tests | BLOCKED |
| SAT-03 | VLAN, firewall, DNS and NTP | Segmented connectivity, firewall rules, synchronized clocks | NOT EXECUTED |
| SAT-04 | BHS transport | Approved Profinet or other contracted transport, framing and source authentication | BLOCKED |
| SAT-05 | Message 2001/2002 | Real BHS BagID preservation and vendor-confirmed acknowledgement framing | BLOCKED |
| SAT-06 | Tagging workstation | Barcode scanner, operator workstation, label procedure and IATA LPC validation | NOT EXECUTED |
| SAT-07 | RFID encoder/writer | Physical writer/encoder only if included in contracted scope | NOT APPLICABLE |
| SAT-08 | RFID readers/antennas | Reader installation, antenna mapping, Reclaim and Customs Exit detection | BLOCKED |
| SAT-09 | Advanced locations | Washroom, employee exit and emergency exit only where contracted | NOT APPLICABLE |
| SAT-10 | Physical alarm output | Approved light/buzzer interface, wiring, safety and acknowledgement | BLOCKED |
| SAT-11 | Recheck scanner | Physical scanner lookup of assigned RFID label barcode | NOT EXECUTED |
| SAT-12 | HBSS serial interface | RS-232 cabling, serial settings, BagID transmission and vendor response | BLOCKED |
| SAT-13 | X-ray recall | Correct image recall under vendor-controlled HBSS conditions | BLOCKED |
| SAT-14 | Manual inspection and resolution | Customs SOP, staff workflow, CLEARED and NOT_CLEARED evidence | NOT EXECUTED |
| SAT-15 | Identity and access | Canonical roles, account lifecycle, session behavior and audit | NOT EXECUTED |
| SAT-16 | Audit, reports and exports | Role-scoped records, retention expectations and safe exports | NOT EXECUTED |
| SAT-17 | Multi-workstation behavior | Refresh/realtime, version conflict and operator hand-off evidence | NOT EXECUTED |
| SAT-18 | Network/reader/database interruption | Safe failures, recovery, restart and no lifecycle corruption | NOT EXECUTED |
| SAT-19 | Performance/load and monitoring | Contracted workload, capacity, monitoring, alerting and log retention | BLOCKED |
| SAT-20 | Training, SOP and customer sign-off | Training records, approved SOP and customer acceptance signature | NOT EXECUTED |

## Site sign-off

| Role | Name | Signature | Date | Conditions/deviations |
| --- | --- | --- | --- | --- |
| BELTCON | ____________________ | ____________________ | __________ | __________ |
| Airport operations | ____________________ | ____________________ | __________ | __________ |
| Customs | ____________________ | ____________________ | __________ | __________ |
| BHS vendor | ____________________ | ____________________ | __________ | __________ |
| HBSS vendor | ____________________ | ____________________ | __________ | __________ |
