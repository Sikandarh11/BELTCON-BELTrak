# BELTCON SBTS Demonstration Runbook V1

## Purpose and safety boundary

This runbook demonstrates the BELTCON SBTS Baseline V1 simulator workflow. It
does not demonstrate airport hardware. Do not run it against production,
customer, shared airport, or unknown databases. The BHS, RFID, and HBSS steps
are software simulations; no physical Profinet, LLRP, RS-232, light, or buzzer
communication occurs.

## Preparation

1. Use an approved disposable demonstration database with migrations 001–023
   applied and record its reset procedure.
2. Start the application and verify build/version, test accounts, active
   canonical profiles, and persisted permissions.
3. Confirm simulator feature flags are enabled only for the non-production
   environment; confirm physical BHS Profinet and HBSS RS-232 flags are false.
4. Prepare a System Administrator, Operations Officer, Control Center
   Operator, and Customs Supervisor. Do not display passwords.
5. Safely reset only the approved demo data. Never use destructive reset
   commands against an airport database.

## Demonstration sequence

| Step | Presenter action | What to show / say |
| --- | --- | --- |
| 1 | Sign in as the authorized simulator operator and open the BELTCON BHS Simulator. | Canonical role and persisted permission—not workspace mode—control access. |
| 2 | Submit semantic message 2001: source `BELTCON_BHS_TEST_SOURCE`, trigger `1`, line `01`, BHS BagID `1234567890`, evaluation `R`. | The external BagID is preserved exactly; the response carries semantic 2002 only after durable processing. |
| 3 | Open Tagging Queue and refresh it. | Server-backed identified bag, BHS line and evaluation; no flight/passenger/X-ray requirement. |
| 4 | Associate barcode `TAG-000001`, EPC `EPC-000001`, and IATA LPC `5127439982`. | This is association only, not physical RFID encoding; barcode and EPC remain distinct. |
| 5 | Simulate an RFID read through `RDR-TEST-01`, port 1. | The server maps antenna port to `RECLAIM`; the browser does not choose the zone. |
| 6 | Simulate a new RFID read through port 2. | Server mapping resolves `CUSTOMS_EXIT` and creates one durable active alarm. |
| 7 | Open Alarms; acknowledge as a Control Center Operator. | Actor, version, action, and audit are server-authoritative. |
| 8 | Send the alarm to Recheck. Optionally demonstrate escalation with a Customs Supervisor and a reason. | Recheck is a state transition; no automatic recall or resolution occurs. |
| 9 | At Recheck, scan `TAG-000001`. | Exact tag lookup retrieves the associated bag and server-stored BHS BagID. |
| 10 | Request HBSS recall. | The result is explicitly `SIMULATED`; no workstation or serial device was contacted. |
| 11 | Record `CLEARED` or `NOT_CLEARED` with required notes for the latter. | Atomic final disposition resolves the bag and closes the alarm while preserving tag/EPC. |
| 12 | Show closed alarm, audit timeline, reports, and reader/antenna mapping. | Traceability is durable server data; exports are permission-scoped and CSV-safe. |

## Recovery demonstrations

- Resubmit the exact BHS message: show idempotent duplicate result.
- Resubmit changed BHS content for the same BagID: show controlled conflict.
- Resubmit the exact RFID source event: show duplicate behavior and no second
  active alarm.
- Attempt invalid barcode/EPC/IATA LPC or unassigned EPC: show safe validation
  failure without automatic association.
- Demonstrate a stale expected version with two test clients: show conflict and
  refetch rather than overwrite.
- Refresh the queue after each completed mutation to show server-backed state.

## Talking points

- The BHS BagID is the common correlation identifier between BHS, tag
  association, RFID location events, Recheck, and HBSS recall.
- Business processing is server-authoritative and transaction/RPC oriented.
- Antenna configuration, not browser input, resolves location.
- Alarm and Recheck histories are durable and auditable.
- Adapters separate safe simulation from later airport hardware integration.

## Demo limitations

- No physical BHS PLC or Profinet communication.
- No physical RFID/LLRP reader or tag writer/encoder communication.
- No physical RS-232/HBSS communication or X-ray recall.
- No physical light/buzzer output.
- No validated cross-browser realtime claim; use refresh/refetch.
- Physical verification, network behavior, performance, backup/restore, and
  airport SOP acceptance require FAT/SAT.
