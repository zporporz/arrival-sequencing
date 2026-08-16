# Bangkok FIR Arrival Sequencing — Project Status

Last reviewed: 2026-08-16

## Production-ready scope

- IVAO SSO login and Thailand Division staff detection.
- Realtime shared arrival sequence with presence and edit activity.
- ETO input, ELDT calculation, CLDT sequence planning, CTO target, ALDT and variance display.
- CLDT spacing/conflict warning and sequence workflow controls.
- Active/completed/cancelled/landed lifecycle handling.
- Staff Admin Console.
- Airport and runway configuration master data.
- Published / Not Published / Archived states are separate.
- STAR procedures are optional and editable from Admin.
- Fix timing editor uses the same `fix_timings` dataset as live sequencing.
- Configuration history is append-only with field-level diff and rollback.
- Session history supports close, reopen, archive and restore.
- Session detail includes stored arrivals, statistics and CSV export.
- VTBD RWY 21L/21R is the only published operational workspace.
- VTBD RWY 21 timing data is linked to its runway configuration and remains marked provisional unless explicitly verified.

## Current master-data state

### VTBD — Don Mueang International Airport
- Airport: Published
- 21L / 21R (flow `21`): Published, Timing Active
- 03L / 03R (flow `03`): Not Published, Timing Pending
- Current STAR records for RWY 21: ENDUU3A, NAKON3A, SABAI3A, SEHNA3A, WEHHA3A

### VTBS — Suvarnabhumi Airport
- Airport: Not Published
- 01 / 02L / 02R: Not Published, Timing Pending
- 19 / 20L / 20R: Not Published, Timing Pending
- Do not publish until source-backed nominal timing is configured and the live multi-airport core is completed.

## Important known limitation

The workspace navigation now reads Published airport/runway records from the Admin master data and can render multiple airports. However, the current `App.tsx` sequencing core still initializes its live session with VTBD defaults (`AIRPORT = VTBD`) and flow-oriented legacy logic.

Therefore:

- Keep VTBD RWY 21 as the only Published live workspace for production use.
- Do not Publish VTBS or another airport yet expecting a fully isolated live session.
- A future refactor must make the live App resolve `airport + runway_config + flow` from the selected published workspace before querying/creating `sequence_sessions`.

This limitation is intentionally documented rather than hidden behind DOM/runtime hacks.

## Data safety

- Airport/runway/STAR records use Archive/Restore rather than destructive deletion.
- Master-data edits are recorded in `config_history`.
- Existing arrivals retain `nominal_seconds_snapshot`, so later timing edits do not rewrite historical calculations.
- Archived sessions are closed as part of the archive action.
- Database allows arbitrary ICAO airport codes for future expansion; the old VTBD/VTBS-only session constraint has been removed.
- A partial unique index prevents more than one non-archived ACTIVE session for the same airport, flow and service date.

## Deferred work

These items are intentionally not fabricated or auto-enabled:

1. Full dynamic multi-airport live sequencing core.
2. VTBD RWY 03 nominal timing dataset.
3. VTBS nominal timing datasets.
4. Automated AIP/STAR import and source reconciliation.
5. Fine-grained staff roles (view/edit/publish permissions) beyond Thailand Division staff access.

## Deployment

Repository: `zporporz/arrival-sequencing`
Production: `https://atc-sequence.pages.dev`
Production branch: `main`

Before declaring a new production workspace ready, verify:

1. Airport is Active + Published.
2. Runway configuration is Active + Published.
3. Timing status is Active.
4. Active reference-fix timings exist and have a documented source.
5. STAR records are present only when the aerodrome/procedure actually has STARs.
6. Live App has been verified to resolve the selected airport/runway rather than VTBD defaults.
7. GitHub Build check is green.
