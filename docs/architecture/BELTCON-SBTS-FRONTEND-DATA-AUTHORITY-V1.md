# BELTCON SBTS Frontend Data Authority V1

## Purpose

This document defines browser-side data authority for SBTS Baseline V1. It prevents a browser tab, seed fixture, or local persistence layer from being treated as a source of operational truth.

## Authority model

```text
React page or component
  -> typed BELTCON domain hook
  -> TanStack Query query or mutation
  -> authenticated server API
  -> server service
  -> repository / transactional RPC
  -> Supabase PostgreSQL
```

Database records and server APIs are authoritative. TanStack Query is the authenticated browser representation of those records. The Zustand `appStore` is restricted to local UI preferences: sidebar state, table density, map layer, simulator tab, and simulator playback speed. Component state is for temporary interaction; `react-hook-form` is form state; `useReducer` is limited to local workflow transitions such as the BHS and Recheck screens.

## Query-key structure

`src/lib/queryKeys.ts` is the single key factory. It provides `authKeys`, `userKeys`, `roleKeys`, `permissionKeys`, `bagKeys`, `taggingKeys`, `rfidKeys`, `readerKeys`, `alarmKeys`, `recheckKeys`, `hbssKeys`, `resolutionKeys`, `auditKeys`, `reportKeys`, and `integrationKeys`.

List filters are copied into stable, serializable, sorted objects. Undefined values are removed, and array values are normalized before a key is created. Hooks must not create literal operational key arrays.

## Freshness policy

The common policy is in `src/lib/queryPolicy.ts`.

| Data | Stale time | Refetch policy |
| --- | ---: | --- |
| Auth session | 15 seconds | Window focus and relevant navigation |
| Tagging, active alarms, Recheck queue | 5 seconds | 15-second interval and mutation invalidation |
| RFID event surfaces | 15 seconds | 30-second interval where a hook exists |
| Reader configuration | 60 seconds | Explicit refetch / future Realtime invalidation |
| Audit | 45 seconds | Future server audit read model |
| Reports | 120 seconds | Future server report read model |

Operational queries do not use seed `initialData`, localStorage fallback, direct browser Supabase reads, or silent empty-array failure handling.

## Mutation policy and invalidation

Mutations wait for the server response and invalidate only affected domains.

| Server-confirmed action | Invalidated keys |
| --- | --- |
| BHS message accepted | Tagging, bags, BHS integration events, audit |
| RFID tag assignment | Tagging, affected bag, RFID-trackable bags, audit |
| RFID read | RFID events, RFID-trackable bags, bags, alarms, audit |
| Alarm acknowledgement/escalation/send to Recheck | Alarm list/detail/actions, affected bag, RFID-trackable bags, Recheck, audit |
| HBSS recall/final resolution | Recheck, alarms, affected bag, audit |

Low-level clients normalize HTTP errors through `AppApiError`. They do not show toast messages, decide authorization, or mutate Zustand. There is no `useAuthorizedMutation` wrapper because existing typed domain mutations already have distinct input and invalidation matrices; a generic wrapper would obscure those contracts.

## Session, Realtime, and offline rules

Logout cancels and clears the entire query cache before navigation. UI preferences remain in Zustand. A subsequent session always refetches protected records.

Supabase Realtime invalidation is deliberately deferred: publication and RLS behavior have not been verified in a disposable environment. Active server-backed operational hooks therefore use targeted polling and mutations invalidate their local keys. No Realtime event writes to Zustand.

Offline writes are not supported. A mutation fails visibly and retains form state for a user retry; sensitive writes are never queued in localStorage.

## Seed and legacy policy

The previous browser persistence service and local bag, alarm, and RFID lifecycle services are deprecated fail-closed facades. They have no operational consumers and contain no direct Supabase writes. Seed data is not used by an operational page as a fallback.

Dashboard, history, map, reader administration, reports, audit, legacy operator scan, target information, and supervisor overview are intentionally marked unavailable until Phase 9 adds their respective server-backed read models. This is safer than displaying a seed record as live airport data.

## Import boundaries

React pages may import client hooks and browser-safe API clients. They must not import server repositories, service-role clients, server-only adapters, browser persistence services, or operational Zustand records. Server APIs call services; services call repositories. Integration keys and service-role credentials remain server-only.

## Phase 9 follow-up

Phase 9 will deliver authenticated, paginated read models for reader health/configuration, RFID history, bag/map detail, operational reports, and audit logs. Once each exists, its placeholder page must be replaced with a typed query hook; no Zustand operational slice should be reintroduced.
