# Manual target concurrency

## Behavior

- Live position, speed, phase and ETA inputs keep updating in MANUAL and FROZEN.
- Dragging changes the controller's Manual TLDT; telemetry must not reject that
  command or restore a preceding AUTO/Manual target. Separation still applies.
- Frozen capture remains approach-derived AUTO metadata. It neither releases a
  drag lease nor acknowledges a pending Manual save.
- `revision` still orders complete flight snapshots. `target_revision` changes
  only with controller/operational target fields or a new canonical flight identity.
  Manual/AUTO writes atomically compare this target version. Genuine competing
  controller changes still return `409 STALE_TARGET`; there is no blind retry.
- A released command is captured immediately and remains protected during its
  debounce/save. A prior save cannot acknowledge the next drag. Older poll, POST
  and animation-frame results cannot replace a newer accepted state.
- A failed save restores authoritative state. Requests time out after 15 seconds;
  an orphaned remote release expires after 30 seconds instead of blocking forever.

## Verification

Run `npm run test`, `npm run build:app`, `npm run check:pages` and
`npm run check:realtime` (the last command is a dry run, not a deployment).

For an isolated PostgreSQL test of the actual migration:

```sh
npm install --prefix tmp/target-revision-check --no-save --package-lock=false @electric-sql/pglite@0.5.8
node scripts/check-target-revision.mjs
```

This uses an in-memory fixture database, never production Supabase. It verifies
telemetry/Frozen updates, repeated drags, stale conflicts, AUTO, GA, flight identity
changes and database ownership of the counter. Frontend regression tests include
an actual React pointer drag and simulated local/secondary-screen response races.
They are not a substitute for a production two-browser smoke test.

## Rollout order (requires deployment authorization)

1. Apply `20260912144012_separate_aman_target_revision.sql` to the intended database.
   It adds a counter/trigger without changing current Manual targets or RLS.
2. Deploy `aman-realtime` with the Frozen metadata/preview distinction.
3. Deploy Pages with the API and frontend together.
4. Refresh all open controller browsers. Older clients retain legacy full-row CAS
   and can still encounter telemetry conflicts until refreshed.
5. Test repeated drags and Return to AUTO in two browsers, including a Frozen
   aircraft. Confirm live tracking continues and successful Manual writes agree.

The migration must precede the API deployment. Do not drop the column/trigger
while any deployed API uses it; reverting application code can leave the additive
migration in place safely.
