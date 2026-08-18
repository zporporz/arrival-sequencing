# Frontend reset baseline

Date: 2026-08-18

The active frontend has been reset to a clean React baseline.

## Backup

Full pre-reset state is preserved on branch:

`backup-pre-frontend-reset-20260818`

Backup commit:

`28a11bb66d96695b8a2dd9bafca1df1c01256f66`

## Preserved infrastructure

The reset does **not** remove or redesign the backend/data integrations. The following remain available for the rebuild:

- IVAO authentication endpoints under `/api/auth/*`
- Workspace API under `/api/workspaces`
- Sequence APIs under `/api/sequence/*`
- IVAO Tracker integrations and server-side `IVAO_API_KEY` usage
- Route geometry / AIRAC integration functions
- Supabase/PostgreSQL database and migrations
- Browser Supabase client configuration and `VITE_SUPABASE_*` environment reads
- Existing database schema and stored operational data

A clean reusable client API wrapper now lives in `src/core/api.ts`.

## Active frontend

`src/main.tsx` mounts only:

- `AuthGate`
- the new minimal `App`
- `reset.css`

Old AMAN, sequencing table, admin editor and workflow components are not mounted by the active application and are excluded from the active TypeScript compilation set. They can be removed permanently after the replacement design is established; the full original state remains recoverable from the backup branch.
