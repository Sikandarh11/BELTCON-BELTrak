# BELTCON SBTS BHS Semantic API V1

## Purpose

`POST /api/integrations/bhs/messages` is the authoritative server-side input for a BELTCON SBTS Baseline V1 semantic BHS message. It is an internal development API, not the airport’s final physical ICD.

## Authentication

The caller must send `x-bhs-integration-key`. The server compares it with the server-only `BHS_INTEGRATION_KEY` and derives the integration source from server-only `BHS_SOURCE_SYSTEM`. Browser sessions, workspace modes, feature flags, and query-string values do not authorize this endpoint.

## Request

```json
{
  "messageType": 2001,
  "trigger": 1,
  "lineId": "01",
  "bhsUid": "0012345678",
  "evaluation": "R"
}
```

The body is JSON, limited to 256 KiB, and rejects unknown fields. `lineId` is exactly two printable ASCII characters. `bhsUid` is exactly ten printable ASCII characters and is preserved without padding, truncation, numeric conversion, or ETB substitution. `evaluation` is one of `A`, `R`, `T`, `N`, or `?`.

## Evaluation and queue eligibility

| Raw | Normalized | Tagging queue |
| --- | --- | --- |
| A | ACCEPT | No |
| R | REJECT | Yes |
| T | TIMEOUT | Yes |
| N | NO_DECISION | Yes |
| ? | MISTRACK | Yes |

`ACCEPT` persists the integration event but creates no suspect bag. The other values create or safely link an `IDENTIFIED` bag without EPC, RFID label barcode, alarm, X-ray, flight, passenger, or threat data.

## Successful response

```json
{
  "requestId": "bhs-request-001",
  "result": {
    "outcome": "ACCEPTED",
    "integrationEventId": "00000000-0000-4000-8000-000000000001",
    "bagId": "ETB-ABC123DEF456",
    "bhsUid": "0012345678",
    "lineId": "01",
    "evaluation": "REJECT",
    "taggingEligible": true,
    "duplicate": false,
    "processingAttemptCount": 1,
    "errorCode": null,
    "errorMessage": null
  },
  "acknowledgement": {
    "messageType": 2002,
    "bhsUid": "0012345678",
    "outcome": "ACCEPTED",
    "timing": "AFTER_DURABLE_COMMIT"
  }
}
```

## Idempotency and conflicts

Idempotency is scoped to authenticated `source_system` plus the deterministic semantic message fingerprint. Exact retries return HTTP 200 with `DUPLICATE`, reuse the original IDs, and increment the durable processing-attempt count. A changed line ID or screening evaluation for an established BHS bag returns HTTP 409 with `REJECTED`; it does not overwrite or reset the bag.

Errors use stable codes: `BHS_AUTHENTICATION_REQUIRED`, `BHS_AUTHENTICATION_FAILED`, `BHS_INVALID_MESSAGE`, `BHS_MESSAGE_TOO_LARGE`, `BHS_MESSAGE_CONFLICT`, `BHS_BAG_CONFLICT`, `BHS_PROCESSING_FAILED`, and `BHS_INTEGRATION_UNAVAILABLE`. Responses never include API keys, database details, or unrestricted request bodies.

## Acknowledgement semantics

The response is a semantic message 2002 acknowledgement produced only after the RPC transaction commits. Outcomes are `ACCEPTED`, `DUPLICATE`, `REJECTED`, or `FAILED`. BELTCON SBTS does not define or emit a physical acknowledgement byte in this phase.

## Deferred physical integration

This endpoint is not a Profinet wire format and the physical BHS adapter remains disabled. Vendor confirmation is still required for the PLC data layout, trigger framing, acknowledgement byte, retry timing, timeout, padding, and final BHS BagID uniqueness scope.
