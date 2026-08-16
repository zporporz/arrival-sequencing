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
- Live sequencing core resolves the selected Published airport + flow + runway configuration dynamically from Admin master data.
- Session lookup/creation, timing lookup, realtime presence, header context and workspace navigation all follow the selected live workspace.
- VTBD RWY 21L/21R is currently the only Published workspace with Timing Active.
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
- The live core is multi-airport capable, but VTBS must not be enabled for sequencing until source-backed nominal timing is configured and Timing status is Active.

## Multi-airport live core

Completed.

The live App now:

- Loads Active + Published airports and runway configurations from `/api/workspaces`.
- Resolves the selected workspace from `?airport=<ICAO>&flow=<FLOW>`.
- Canonicalizes the URL with airport, flow and runway label.
- Queries or creates `sequence_sessions` using the selected airport + flow + UTC service date.
- Excludes archived sessions from live selection.
- Handles concurrent session creation using the database uniqueness guard.
- Loads `fix_timings` using the selected session airport + flow.
- Uses a realtime/presence channel scoped to the selected session id.
- Renders Airport / Runway workspace navigation directly in React.
- Disables Add Flight when the selected Published runway does not have Timing Active or has no active timing records.
- Shows a timing-unavailable warning for Published PENDING/DISABLED workspaces.
- Uses dynamic airport names in the header and provisional timing footer.

The old DOM-based workspace selector has been removed from runtime and its source file deleted. `flowSelector.css` remains because the React workspace navigation reuses those styles.

## Data safety

- Airport/runway/STAR records use Archive/Restore rather than destructive deletion.
- Master-data edits are recorded in `config_history`.
- Existing arrivals retain `nominal_seconds_snapshot`, so later timing edits do not rewrite historical calculations.
- Archived sessions are closed as part of the archive action.
- Database allows arbitrary four-character A-Z/0-9 airport codes for future expansion; old VTBD/VTBS-only constraints have been removed from sessions and timing data.
- A partial unique index prevents more than one non-archived ACTIVE session for the same airport, flow and service date.
- The `prepare_arrival()` trigger derives timing from the arrival's actual session airport + flow; it contains no VTBD-specific lookup.

## Deferred data / optional enhancements

These items are intentionally not fabricated or auto-enabled:

1. VTBD RWY 03 nominal timing dataset.
2. VTBS nominal timing datasets.
3. Automated AIP/STAR import and source reconciliation.
4. Fine-grained staff roles (view/edit/publish permissions) beyond Thailand Division staff access.
5. Additional security hardening of the prototype browser-side Supabase RLS policies before treating the application as a controlled production service.

## Deployment

Repository: `zporporz/arrival-sequencing`
Production: `https://atc-sequence.pages.dev`
Production branch: `main`

Before declaring a new live workspace ready, verify:

1. Airport is Active + Published.
2. Runway configuration is Active + Published.
3. Timing status is Active.
4. Active reference-fix timings exist and have a documented source.
5. STAR records are present only when the aerodrome/procedure actually has STARs.
6. The selected workspace opens with the correct airport/flow in the URL and creates/loads the matching session.
7. Add Flight is enabled only when active timing records are available.
8. GitHub Build check is green.
