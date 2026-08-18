# Approach AMAN Rebuild Baseline

**Baseline date:** 2026-08-18

The active `main` branch is now the clean baseline for the new Approach AMAN rebuild.

## Preserve

- IVAO authentication and session APIs
- IVAO Tracker access and `/api/sequence/ivao-traffic`
- AIRAC route geometry API
- AIP/STAR data and mapping helpers
- Supabase connection, migrations and backend infrastructure
- `/api/workspaces`
- AMAN research under `research/aman/`
- new core AMAN constants, ETA engine and sequencing engine under `src/core/`
- environment-variable configuration

## Remove from active frontend

The old dashboard/admin/sequence UI and its CSS/helpers are removed from `main`. They remain recoverable from the backup branch:

`backup-pre-frontend-reset-20260818`

The rebuild must not copy old UI assumptions back into the new interface unless the new operational research explicitly supports them.

## Legacy backend

Existing sequence/session/database endpoints that still use the older `ETO / CLDT / CTO` model remain temporarily in place. They are infrastructure/compatibility code only and are **not** the semantic model for the new MAESTRO-style AMAN.

They should be replaced/migrated only after the new read-only AMAN flow is proven.

## Build order

1. Read-only live AMAN pipeline: IVAO traffic -> IAWP -> ETA -> automatic sequence -> TLDT/TTO/delay.
2. MAESTRO-style vertical timeline.
3. Controller interaction: drag/confirm/resequence/runway/holding.
4. New persistence/data model.
5. Retire the legacy sequence backend and old database semantics.

## Public frontend during rebuild

The production frontend intentionally shows an **UNDER CONSTRUCTION** page while the new AMAN interface is built behind this clean baseline.
