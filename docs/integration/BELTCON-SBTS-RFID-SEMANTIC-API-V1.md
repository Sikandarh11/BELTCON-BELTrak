# BELTCON SBTS RFID Semantic API V1

## Purpose

This server API accepts normalized RFID read observations for SBTS Baseline V1. It is not an LLRP, reader-vendor, or physical wire protocol. A future BELTCON RFID Adapter will translate hardware traffic into this semantic contract.

## Authentication

`POST /api/integrations/rfid/reads` requires the server-configured `RFID_INTEGRATION_KEY` in the `x-rfid-integration-key` header. The browser never receives this credential. The development simulator instead calls `/api/dev/simulator/rfid/reads` and requires an authenticated canonical System Administrator with `developer.access`; production simulator use is disabled unless explicitly enabled.

## Request contract

```json
{
  "sourceEventId": "RFID-SIM-000001",
  "readerId": "RDR-001",
  "antennaPort": 1,
  "epc": "EPC-000001",
  "readAt": "2026-07-28T10:15:30.000Z",
  "rssiDbm": -43.5
}
```

Required values are the source event identity, reader, antenna port, EPC, and ISO-8601 read time. Optional bounded values are RSSI, TID, device sequence, and boot ID. A zone is intentionally not accepted: the server resolves location from the configured `(readerId, antennaPort)` mapping.

## Location and idempotency

`reader_antennas` maps enabled reader ports to `TAGGING`, `RECLAIM`, `CUSTOMS_EXIT`, `RECHECK`, `WASHROOM`, `EMPLOYEE_EXIT`, `EMERGENCY_EXIT`, `LOST_AND_FOUND`, `CORRIDOR`, or `OTHER`. Exact retries are scoped to `source_system + source_event_id`; they return `DUPLICATE` and the original event ID without another event or bag update.

## Behaviour

- Unknown EPC: stores an immutable diagnostic event with `UNASSIGNED_EPC`; no bag or alarm is created.
- Known EPC: links the event to the bag found by EPC, never by client-supplied bag ID.
- RECLAIM: a `TAGGED` bag advances to the database arrival/transit status and its location updates.
- CUSTOMS_EXIT: returns `EXIT_DETECTED` and `alarmEligible: true`; Phase 5 creates no alarm.
- RECHECK and advanced zones: record the derived location only. They do not resolve bags, recall HBSS images, create alarms, or start escalation/dwell logic.

## Safe response example

```json
{
  "requestId": "...",
  "result": {
    "outcome": "BAG_DETECTED",
    "duplicate": false,
    "eventId": "...",
    "bagId": "...",
    "readerId": "RDR-001",
    "antennaPort": 1,
    "zone": "RECLAIM",
    "alarmEligible": false
  }
}
```

Errors include `RFID_AUTHENTICATION_REQUIRED`, `RFID_AUTHENTICATION_FAILED`, `RFID_INVALID_EVENT`, `RFID_EVENT_TOO_LARGE`, `RFID_READER_NOT_FOUND`, `RFID_READER_DISABLED`, `RFID_ANTENNA_NOT_FOUND`, `RFID_ANTENNA_DISABLED`, `RFID_EVENT_CONFLICT`, and `RFID_PROCESSING_FAILED`. No SQL errors, integration keys, or service-role credentials are returned.

Physical reader connectivity, LLRP transport, antenna configuration administration, Customs Exit alarm creation, Recheck, and HBSS recall remain future work.
