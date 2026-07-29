# BELTCON SBTS Read Models, Reporting, and Audit V1

## Purpose

Phase 9 makes Reader Management, Operational Reports, and Audit Log pages read from authenticated server APIs. TanStack Query owns browser cache state; Supabase/PostgreSQL remains authoritative. Zustand retains UI preferences only.

## Reader inventory and health

`GET /api/readers` provides paginated inventory and accepts bounded search, health, enabled-state, zone, and allowlisted sort filters. `GET /api/readers/{readerId}` provides reader detail, antenna mapping, and bounded activity totals.

Health is calculated server-side:

- `DISABLED` when configuration is disabled.
- `ONLINE` when a persisted RFID activity timestamp is within `READER_ONLINE_THRESHOLD_SECONDS` (default 300 seconds).
- `DEGRADED` after the online threshold through `READER_OFFLINE_THRESHOLD_SECONDS` (default 3600 seconds).
- `OFFLINE` after the offline threshold.
- `UNKNOWN` when there is no authoritative activity.

No device-heartbeat transport exists in V1, so reader health is explicitly labeled as derived from RFID activity. Firmware, vendor, and model values are only displayed when stored; the UI never fabricates uptime, temperature, network details, or device state.

## Antenna mapping and configuration limits

Antennas map a persisted reader port to one approved SBTS zone: `TAGGING`, `RECLAIM`, `CUSTOMS_EXIT`, `RECHECK`, `WASHROOM`, `EMPLOYEE_EXIT`, `EMERGENCY_EXIT`, `LOST_AND_FOUND`, `CORRIDOR`, or `OTHER`.

`PATCH /api/readers/{readerId}` and `PATCH /api/readers/{readerId}/antennas/{antennaId}` require `reader.manage`, an expected version, and a reason. Migration 022 uses security-definer RPCs so the configuration update and durable audit insertion are atomic. These endpoints change database configuration only. BELTCON SBTS V1 does not send LLRP, Profinet, RS-232, network, restart, calibration, firmware, or credential commands to physical devices.

## Report catalog and filters

The focused report APIs are:

- `GET /api/reports/bag-lifecycle`
- `GET /api/reports/tagging`
- `GET /api/reports/rfid`
- `GET /api/reports/alarms`
- `GET /api/reports/recheck`
- `GET /api/reports/readers`
- `GET /api/reports/integrations`

They require `report.view`. Supported filters are date range, BHS line, screening evaluation, bag status, zone, reader, alarm status/severity, resolution disposition, and integration source where relevant. The maximum interactive range is 90 days. Aggregates are calculated in server repositories from bounded rows; client pages only render server summaries, series, and breakdowns.

Data limitations are returned in every response when appropriate, such as unavailable reader heartbeats, HBSS simulation status, no records, or bounded query truncation.

## Export safety

`GET /api/reports/{reportType}/export/csv` and `GET /api/audit/events/export/csv` apply the same server authorization and filters as their parent read model. CSV cells beginning with `=`, `+`, `-`, or `@` are prefixed before output. Exports have stable, restricted columns and do not include credentials, tokens, cookies, service-role data, or uncontrolled raw metadata.

## Audit query model

`GET /api/audit/events` and `GET /api/audit/events/{auditId}` require `audit.view`. List filters cover pagination, search, action, actor, target type/ID, outcome, date range, and request ID. Results sort newest first with a stable ID tie-breaker.

Audit metadata is sanitized server-side by a recursive allowlist-style removal of sensitive-key names (passwords, tokens, secrets, credentials, cookies, authorization data, and service-role material). Human-readable summaries are generated from durable event actions while safe structured metadata remains available in the event-detail view.

## Pagination, keys, and refetching

All operational table responses use `{ items, page, pageSize, total, totalPages }`. Page sizes are limited to 10, 25, 50, or 100. Query keys come only from `src/lib/queryKeys.ts`:

- `readerKeys.list`, `readerKeys.detail`, `readerKeys.antennaMap`, `readerKeys.health`
- `reportKeys.bagLifecycle`, `tagging`, `rfid`, `alarms`, `recheck`, `readers`, `integrations`
- `auditKeys.list`, `auditKeys.detail`

Reader mutations invalidate only reader, antenna-map, RFID mapping, reader report, and audit keys. Reports do not depend on Realtime; query stale times and manual refresh provide the V1 refetch policy. Live cross-browser Realtime invalidation has not been verified.

## Performance and deferred work

Migration 022 adds additive indexes for reader/antenna configuration, RFID event activity, alarms, resolutions, and audit filters. Runtime query plans and index effectiveness still require a disposable PostgreSQL/Supabase environment.

Deferred from V1:

- Physical reader heartbeat transport and reader-health history.
- Physical reader management and device protocols.
- Analytics warehouse, OLAP cube, and background reporting pipeline.
- Multi-airport tenancy and notification workers.
