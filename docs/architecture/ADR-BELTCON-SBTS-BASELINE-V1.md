# ADR: BELTCON SBTS Baseline V1

## Status

Accepted as a semantic baseline. This decision deliberately does not activate a hardware integration or replace existing BELTCON SBTS workflows.

## Context and source documents

The referenced baseline requirements describe a BHS-led tagging flow and an HBSS recall workflow. The available original ICD identifies BHS message types 2001 and 2002, a BHS BagID/BSM field, screening evaluation, and a later serial HBSS recall telegram. Several wire-level details remain unresolved, so this ADR freezes only the safe BELTCON SBTS semantics.

## Baseline operational flow

`BHS BagID → X-ray screening → screening evaluation → eligible bag to Tagging Station → BHS message 2001 → operator attaches/scans RFID label → SBTS associates RFID with BHS BagID → reclaim → Customs Exit RFID read → alarm → Recheck RFID scan → SBTS retrieves BHS BagID → HBSS recalls original X-ray image → manual inspection → resolution.`

## Identifier definitions

The external common identifier is **BHS BagID** (`bhsUid`): exactly ten printable ASCII characters, preserved exactly after validation. It is never interchangeable with an internal database ID, the BELTCON SBTS display ID (`ETB-*`), IATA Licence Plate Code, RFID EPC, or RFID tag barcode. `ETB-*` is not an acceptable fallback unless it independently satisfies the BHS BagID contract.

`iataLpc` is optional and, when present, exactly ten numeric digits. It is a baggage Licence Plate Code, not an airport code; values such as `RUH`, `JED`, and `DXB` are invalid. The existing `iata_code` database column is not renamed in this phase.

## BHS message 2001

Message 2001 is BHS PLC → SBTS Tagging Station. Its semantic fields are `trigger`, `lineId`, `bhsUid`, and `evaluation`. The baseline semantic API requires new-message `trigger: 1`; final physical PLC framing remains deferred. `lineId` is exactly two printable ASCII characters; `bhsUid` is exactly ten. Evaluation is one of `A`, `R`, `T`, `N`, `?`, mapping to `ACCEPT`, `REJECT`, `TIMEOUT`, `NO_DECISION`, and `MISTRACK`.

The historical field sizes are trigger 1 byte, LineID 2 bytes, BHS BagID 10 bytes, and evaluation 1 byte. Domain validation never silently truncates or pads values. Transport-specific padding, if any, belongs solely in a future Profinet adapter.

## BHS acknowledgement 2002

Message 2002 is SBTS → BHS PLC. It contains the BHS BagID and a semantic outcome: `ACCEPTED`, `DUPLICATE`, `REJECTED`, or `FAILED`. Its timing is always `AFTER_DURABLE_COMMIT`; an accepted acknowledgement is never produced before the durable transaction succeeds. Exact duplicate delivery may receive `DUPLICATE`. Validation and persistence failures must not be acknowledged as accepted. The final one-byte acknowledgement mapping is intentionally unresolved and belongs to the future adapter.

## Evaluation and tagging contract

`A/ACCEPT` does not enter the Tagging Queue. `R/REJECT`, `T/TIMEOUT`, `N/NO_DECISION`, and `?/MISTRACK` are eligible. Version 1 tagging is **Assign RFID Tag**, a scan-and-associate operation: RFID tag barcode and EPC are associated with BHS BagID, optionally with IATA LPC. It is not physical chip encoding, label printing, verification readback, or encoder-SDK work. Existing operations named `encode-tag` remain unchanged for compatibility, but their current database meaning is association rather than physical encoding.

## HBSS recall contract

At Recheck, the RFID tag identifies the active bag; SBTS retrieves `bhsUid` and requests HBSS recall. `HbssRecallRequest` carries `bagId`, `bhsUid`, `stationId`, `requestedAt`, and `requestedBy`. Results are `SENT`, `ACKNOWLEDGED`, `FAILED`, `UNAVAILABLE`, or `SIMULATED`. The documented future serial telegram is `<STX><BAGID><CR><LF>` with ASCII, 9600 baud, even parity, 8 data bits, 1 stop bit, and no handshaking. No serial port is opened in Version 1.

`SimulatedHbssRecallAdapter` is a safe no-I/O implementation. `Rs232HbssRecallAdapter` is explicitly unavailable and does not claim connectivity. Neither is wired to Recheck in this phase.

## Simulator and real-adapter boundaries

`BhsInboundAdapter`, `BhsAcknowledgementAdapter`, and `HbssRecallAdapter` are semantic boundaries only. Browser-safe domain code imports neither server-only code nor Node/hardware libraries. Future real adapters must authenticate integration sources, contain all vendor wire framing, and map semantic acknowledgements to vendor bytes.

## Feature flags and legacy compatibility

The typed flags centralize baseline, legacy screening compatibility, internal X-ray viewer, advanced RFID zones, threat classification, flight integration, simulators, and real adapter controls. Development defaults preserve current simulator/X-ray demonstrations. Production defaults disable simulators and both real adapter flags. Workspace mode, including Developer, is never an input to feature flags and grants no authority. Legacy screening compatibility remains enabled until a later verified BHS migration replaces it.

## Security rules

Workspace mode is a UI preference only. Feature flags grant no permissions. Simulators require server-side authorization; real endpoints must authenticate their integration source. A client-generated BELTCON SBTS display ID must not substitute for BHS BagID. No service-role credential, raw secret, or unrestricted vendor payload may enter browser bundles or logs.

## Deferred Version 2 work

No database migration, queue migration, page refactor, Profinet framing, PLC connection, RS-232 connection, hardware SDK, physical RFID writing, printing, verification readback, or final HBSS deployment behavior is implemented here. Current screening, Tagging Queue, tag association, RFID simulator, alarms, Recheck, X-ray viewer, authentication, Manage Users, and Manage Roles remain compatible and unchanged by intent.

## Known ambiguities requiring vendor confirmation

- Actual Profinet data layout.
- Profinet gateway/device model.
- Trigger byte value.
- Final acknowledgement-byte value.
- Whether BHS values use null or space padding.
- Vendor retry interval.
- Vendor acknowledgement timeout.
- Whether BHS BagID uniqueness is global or per line/site.
- Actual RS-232 cable responsibility.
- Actual serial port device/path.
- Whether HBSS sends any response after BagID recall.
- Whether STX, CR, and LF are actual transmitted characters.
- Whether the existing legacy screening integration remains at final airport deployment.

## Consequences

Future work has one typed, validated vocabulary and deterministic message fingerprint. The domain model does not encode uncertain vendor choices, so a future adapter can be changed without contaminating the queue, lifecycle, or browser UI. This is intentionally a compatibility layer, not an operational migration.
