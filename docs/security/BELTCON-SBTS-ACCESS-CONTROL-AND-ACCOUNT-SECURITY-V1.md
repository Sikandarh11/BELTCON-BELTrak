# BELTCON SBTS Access Control and Account Security V1

## Purpose

This document defines the Phase 10 access-control contract for BELTCON SBTS. It separates browser convenience from server authority: workspace mode is a local UI preference; the current authenticated profile and persisted role-permission grants are the authorization source of truth.

## Authentication model

The browser submits credentials only to the BELTCON authentication endpoint. Session and refresh tokens are placed in HttpOnly cookies with `Path=/` and `SameSite=Strict`; the `Secure` attribute is enabled in production. JavaScript does not receive those cookie values. Every protected server request resolves the session again, then resolves the current `public.profiles` record.

`auth.users` and `public.profiles` are a one-to-one identity pair with the same UUID. Supabase Auth owns credentials. Profiles contain identity, canonical role, account state, password-change state, and lifecycle metadata only; they never contain a password, password hash, recovery token, cookie, access token, or service credential.

CSRF exposure is reduced by Strict same-site cookies and same-origin JSON endpoints. A future cross-site deployment must re-evaluate this model before relaxing `SameSite` or adding cross-origin APIs.

## Canonical roles

Only the following persisted profile values are canonical roles:

- Operations Officer
- Control Center Operator
- Customs Supervisor
- Airport Administrator
- System Administrator

Short labels such as Admin, Developer, Operator, Supervisor, and Auditor are workspace modes. They are stored only as UI preferences and are never read by server authorization.

## Authorization model

`permissionAuthorization.server.ts` is the central server-only authority. It resolves a session, the current profile, account state, current role row, and granted persisted permission codes. It returns a typed authorized actor only for an active profile and active role. It fails closed for a missing profile, inactive/PENDING account, suspended account, locked account, deactivated account, malformed status, unknown permission, missing session, and missing grant.

Protected routes use `PAGE_PERMISSION_RULES` for UX and wait for session resolution before mounting page queries. The route map does not replace server checks. Every operational mutation retains an exact server-side persisted permission check.

## Permission catalog

The persisted catalog includes existing compatibility codes and additive atomic codes. Current operational codes include `dashboard.view`, `bag.read`, `bag.manage`, `bag.tag`, `bag.recheck`, `bag.resolve`, `alarm.read`, `alarm.acknowledge`, `alarm.escalate`, `alarm.close`, `rfid.read`, `reader.view`, `reader.manage`, `report.view`, `audit.view`, `xray.view`, and `xray.refresh`.

Administrative codes include `user.view`, `user.manage`, `user.create`, `user.update`, `user.activate`, `user.suspend`, `user.lock`, `user.deactivate`, `user.reset_password`, `role.view`, `role.manage`, `permission.manage`, `settings.read`, and `settings.manage`.

Development compatibility uses `developer.access`; simulator execution uses the narrower `simulator.use` permission plus a non-production feature flag. The catalog metadata in TypeScript mirrors persisted codes for validation and UI names; it is not a client-side grant source.

## Current matrix and recommendation

Migration 023 preserves every existing role-permission row. It seeds only previously absent atomic permissions with a conservative baseline. This is intentionally not an automatic replacement of management-approved grants.

Recommended review baseline:

| Role | Recommended scope |
| --- | --- |
| Operations Officer | bag read/tag, alarm read, operational recheck where approved |
| Control Center Operator | bag/alarm/RFID read, alarm acknowledgement, reader read |
| Customs Supervisor | bag read/recheck/resolve, alarm read/acknowledge/escalate, reports and approved audit access |
| Airport Administrator | operational reads, reader configuration, reports/audit, approved limited user lifecycle operations |
| System Administrator | technical administration, user/role/permission/settings management, enabled simulators |

The production database matrix must be reviewed and approved before changing established grants. The Manage Roles page reads and writes it through the server API and never initializes it from hardcoded React defaults.

## Route-permission map

| Route group | Required persisted permission |
| --- | --- |
| `/tagging` | `bag.tag` |
| `/alarms` | `alarm.read` or `alarm.acknowledge` |
| `/recheck`, `/target` | `bag.recheck` |
| `/readers` | `reader.view` |
| `/reports` | `report.view` |
| `/audit`, `/settings/audit` | `audit.view` |
| `/settings/users` | `user.view` |
| `/settings/roles` | `role.view` |
| `/dev/simulator` | `simulator.use` |

Other developer pages remain `developer.access` compatibility pages. The server APIs always make the final authorization decision.

## Endpoint-permission map

| Operation | Permission |
| --- | --- |
| BHS and RFID simulator messages | `simulator.use`, `developer.access` compatibility permission, and environment flag |
| RFID tag assignment | `bag.tag` |
| Alarm acknowledge / escalate / send to Recheck | `alarm.acknowledge` / `alarm.escalate` / `bag.recheck` |
| HBSS recall and Recheck resolution | `bag.recheck` / resolution policy |
| X-ray view / refresh | `xray.view` / `xray.refresh` |
| Reader and antenna configuration | `reader.manage` |
| Report and audit export | `report.view` / `audit.view` |
| List users / create / edit / repair | `user.view` / `user.create` / `user.update` |
| User action | `user.manage` compatibility plus an atomic lifecycle permission |
| View / update role matrix | `role.view` / `role.manage` |

Integration endpoints use their separate equipment keys and do not accept browser sessions as equipment authority. Human endpoints do not accept equipment keys.

## Account states and session behavior

`ACTIVE` profiles may perform their granted operations. `PENDING`, inactive, `SUSPENDED`, `LOCKED`, `DEACTIVATED`, missing, and unknown profiles fail closed. A profile is reloaded on every protected server request, so a suspended, locked, or deactivated account cannot continue BELTCON operations merely because an upstream provider token has not expired.

Supabase user-id global sign-out support is not assumed. Status enforcement is immediate for BELTCON APIs; provider-token revocation remains an integration limitation to verify before a production policy claims it.

Logout cancels and clears the TanStack Query cache in the root handler so previous operational records cannot be shown to the next browser user. Harmless workspace/debug preferences may remain local.

## User lifecycle and passwords

User creation and invitation use server-side Supabase Admin APIs. A matching profile is created using the Auth UUID. Profile creation failure triggers Auth-user cleanup; cleanup failure is recorded as a controlled repairable partial failure. Responses, profiles, audit metadata, query cache, Zustand, localStorage, and URLs never contain temporary passwords.

Temporary-password users have `must_change_password=true`. They may authenticate but are redirected to `/change-password` and operational routes/APIs are blocked until the Auth password update and profile completion succeed. The profile flag is cleared only after successful Auth update. Password change writes a durable audit record and attempts other-session revocation where supported.

Forgot-password responses remain generic whether or not an account exists. Recovery state is handled by Supabase and is not stored in Zustand.

## Privileged safeguards

Reasons are required for profile repair, user edit/lifecycle actions, and role-permission updates. User lifecycle changes use expected versions and durable profile/audit RPCs. The final active System Administrator cannot be deactivated, suspended, locked, demoted, or deleted. A user cannot suspend, lock, deactivate, or alter their own canonical role. Role-permission updates cannot add grants to the actor's own canonical role and retain critical administration grants.

Assigning System Administrator remains a high-risk, canonical System Administrator action with reason and audit requirements. Two-person approval and step-up MFA are deferred.

## Mutation and form rules

`useAuthorizedMutation` is a browser-side consistency wrapper only. It disables automatic retry for mutations, invalidates configured queries after server success, refreshes session-derived state after 401/403, preserves values on failure, and does not grant access or hide errors.

Priority login, forgot-password, and change-password forms use react-hook-form plus Zod. They show field errors, disable duplicate submission, and clear passwords after use. Administrative and operational forms continue to require server schema validation even when client validation exists.

## Security audit requirements

Critical writes record durable audit events with actor, canonical role, target, outcome, request ID, time, before/after values, and reason where appropriate. Audit records must never include passwords, recovery links, cookies, JWTs, service credentials, or integration keys. Failed privileged writes are recorded where their current transaction boundary permits.

## MFA readiness and deferred work

MFA is not simulated. A future assurance-level check should be evaluated at System Administrator assignment/removal, role permission updates, administrator deactivation, administrator password reset, integration configuration changes, security-setting changes, and sensitive audit export. Station operators may later use badge plus PIN; administrators may later use password plus OTP or hardware token.

SSO, SCIM, full MFA, two-person approvals, durable distributed transactions between Supabase Auth and PostgreSQL, and verified provider-wide session revocation are intentionally deferred.
