# BELTCON SBTS Customs Exit Alarm Workflow V1

## Scope

This workflow is the durable BELTCON SBTS software response to a tagged,
unresolved suspect bag being observed by a server-configured `CUSTOMS_EXIT`
RFID antenna. It does not operate physical lights or buzzers, retrieve HBSS
images, resolve a bag, or close an alarm.

## Authoritative flow

1. An RFID integration or enabled development simulator submits a normalized RFID read.
2. `process_beltcon_rfid_read_v2` reuses the V1 reader, antenna, EPC and event-idempotency checks.
3. The RPC derives the zone from `reader_antennas`; a client cannot declare an exit zone.
4. An unassigned EPC remains an immutable RFID event and creates no alarm.
5. A resolved or Recheck bag remains in its current lifecycle state and creates no alarm.
6. For a `TAGGED` or `IN_ARRIVAL_HALL` bag at `CUSTOMS_EXIT`, the same transaction records one `HIGH` Customs Exit alarm, an `OPENED` action, the relevant audit event, and moves the bag to `ALARMED`.
7. The partial unique index permits historical alarms but enforces one active Customs Exit alarm per bag, zone and rule. A later, distinct RFID observation returns `ALARM_ALREADY_ACTIVE`; an exact RFID retry remains `DUPLICATE`.
8. Authorized staff use the server APIs to acknowledge, escalate, or send the bag to Recheck. Each action uses `alarms.version` for optimistic locking and appends durable action/audit evidence.

`SENT_TO_RECHECK` is an active workflow status. It is not a final disposition and does not close the alarm. Final closure and resolution are deliberately deferred to Phase 7.

## Authorization

The alarm list/detail APIs require the persisted `audit.view` permission, the
verified equivalent of a read permission in the current catalog. Human actions
require persisted `alarm.acknowledge`, `alarm.escalate`, or `bag.recheck` as
appropriate. The server reloads the active profile and role permissions through
`requirePermission`; workspace mode and client-side visibility grant nothing.

## Client behaviour

`/alarms` is a TanStack Query view over `/api/alarms` and `/api/alarms/{id}`.
It does not merge Zustand, browser persistence, or seeded alarms into the
authoritative queue. Targeted query invalidation follows successful actions and
RFID reads. Cross-browser live Realtime updates are intentionally deferred; a
refresh or normal query refetch obtains the durable state.

## Deferred production capabilities

- Physical light/buzzer output through a confirmed adapter/outbox contract
- HBSS image recall and Recheck resolution
- Final alarm closure and final disposition transaction
- Additional alert rules (washroom, employee exit, emergency exit and dwell time)
- Notification-delivery workers and multi-airport routing
