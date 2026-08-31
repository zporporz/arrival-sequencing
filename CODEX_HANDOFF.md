# Codex Handoff — ATC Arrival Sequencing / Thailand AMAN

Last updated: 2026-08-31
Repository: `zporporz/arrival-sequencing`
Production: `https://atc-sequence.pages.dev`
Supabase project: `jamwzmqcerkivkgpezfh`

## Start here

Before changing anything, inspect current `main`. This handoff describes the intended behaviour and the latest work, but current code is the source of truth for exact implementation details.

Do not delete or reset shared operational data, especially `aman_flight_states`.

The production app requires an authenticated IVAO session. Admin navigation and admin APIs are Thailand-staff-only. Successful IVAO logins are audited for staff review.

## Terminology that must stay consistent

Pairwise separation language is always:

`X ต่อ Y` = X is the FOLLOWER, Y is the LEADER.

Final-approach special spacing:

- B behind B = 2 min
- Any non-B behind B = 4 min
- Any follower behind A380/A388 = 7 NM
- B behind A = 7 NM
- C/D behind A = 12 NM
- Otherwise use existing LAND SEP

All AUTO/manual/cascade/conflict/cross-runway paths should use the same pairwise source of truth (`resolveAmanPairwiseSeparationSeconds(...)` or the established wrapper around it).

Keep separate from the older follower-based landing minima:

- A380/J follower = 3 min
- ATR/AT7 follower = 4 min

## ETA / ETO architecture

Legacy/full ETA model is preserved in:

- `src/core/arrivalEtaLegacy.ts`

Stage wrapper is in:

- `src/core/arrivalEta.ts`

Current stage concepts:

1. BOARDING: `ETOT = max(EOBT, NOW) + STT`; ETA-FF from ETOT + EET - STAR nominal.
2. DEPARTING: first observed IVAO Departing time acts as AOBT; stage is latched and must not revert to BOARDING.
3. AIRBORNE: takeoff baseline plus live ETA candidate.

Airborne ETA behaviour now has two stages:

- During the initial climb, monotonic-earlier protection prevents unstable live samples from moving ETA-FF later.
- At FL300, or within 1,000 ft of the filed cruise altitude when that is lower, dynamic mode latches for the rest of the flight.
- In dynamic mode, live ETA may move both earlier and later, so hold/vector/slowdown delay propagates into ETA-FF and the automatic sequence.
- Changes smaller than 30 seconds remain inside the display deadband to avoid flicker.

The automated regression test `allows ETA to move later after a hold/vector slowdown at cruise altitude` covers the later-moving case. Do not restore permanent monotonic-earlier behaviour after the dynamic trigger.

IVAO `departureTime` is currently used as the EOBT proxy.

## Flight lifecycle / status

Operational status sequence:

`UNSTABLE -> STABLE -> SUPERSTABLE -> FROZEN`

Current project thresholds:

- STABLE: roughly T-15 to IAWP
- SUPERSTABLE: roughly T-5 to IAWP
- FROZEN: PRIMARY = aircraft detected at 10 NM final on assigned runway
- FROZEN fallback = `TLDT - NOW <= 4 min` only when final geometry / live track cannot be evaluated

Files:

- `src/etaFfLifecycleRuntime.ts`
- `src/finalTenNmRuntime.ts`

### Critical lifecycle rule

**TLDT is NOT hard-locked by any lifecycle stage.**

ATC must be able to drag TLDT in STABLE, SUPERSTABLE and FROZEN. If a dragged aircraft pushes later followers, those followers must cascade according to separation even when they are FROZEN.

ETO / ETA-FF locking is separate. The user has confirmed that the current stage at which ETO/ETA-FF becomes locked is already correct. Do not redesign that stage logic unless explicitly asked.

Recent fix: when ETO is already locked and TLDT is dragged, the ETO display must not visibly move and then snap back. `etaFfLifecycleRuntime.ts` now restores the locked display before paint.

## FROZEN 10 NM final detection

`src/finalTenNmRuntime.ts` fetches live IVAO traffic and compares aircraft position to assigned runway geometry.

Detection is intended to require:

- valid assigned runway
- live/fresh aircraft position
- airborne aircraft
- aircraft in front of the threshold on extended final
- acceptable cross-track distance from centreline
- heading reasonably aligned with runway
- along-track distance <= 10 NM

Once FROZEN is entered, status is latched.

If the geometry/track cannot be evaluated, lifecycle code may use the 4-minute TLDT fallback.

## Drag / reorder semantics — VERY IMPORTANT

The intended UX is directional.

### Drag UP (later TLDT)

- Pure live TLDT push
- Preserve sequence order
- NO replace / reorder
- NO yellow drop target
- The dragged aircraft strip must move with the mouse immediately
- Any later/follower aircraft constrained by pairwise SEP must cascade upward live
- The follower strips themselves must move visually live, not just their TLDT text
- Releasing the mouse only ends the drag; no special drop action is required

### Drag DOWN (earlier TLDT / resequence)

- Normal TLDT movement is allowed.
- Sequence rank changes live when the pointer crosses the centre of another eligible callsign row.
- The user does not need to overlap the boxes or release on an exact yellow target.
- The yellow row is feedback for the latest crossed target; it is not a second aircraft attached to the drag.
- Releasing commits the latest crossed order once. Tight adjacent rows must behave the same as widely spaced rows.

Relevant files:

- `src/manualSequenceReorderRuntime.ts`
- `src/timelineDisplayScaleRuntime.ts`
- `src/AppMaestroV24.tsx`

Recent fixes preserve browser pointer-capture cleanup after reorder, prevent adjacent strips remaining stuck together and use the same VTBD airport-wide ordering path for TEST and live traffic.

### Important architecture rule

**Sequence order and TLDT must be treated as separate concepts.**

A pure manual TLDT move must not silently infer a new sequence order simply because timestamps cross.

The runtime currently latches an explicit order in `groupOrders` at pointerdown and publishes it via `setAmanManualSequenceOrderSnapshot(...)`.

Shared-state sync must not overwrite an already-latched complete order merely from `manual_tldt` values.

### Sequence-rank invariant

`applyManualTargetsWithCascade()` may sort its returned rows by TLDT for timeline rendering, but it explicitly preserves each row's existing `sequenceIndex`. Do not reintroduce `sequenceIndex = index + 1` from TLDT chronology. Regression tests cover TLDT crossing while rank remains unchanged.

## Current cascade behaviour

`applyManualTargetsWithCascade()` starts each row from manual TLDT when present, otherwise AUTO TLDT.

For each airport/runway, followers are processed in sequence order and constrained to at least:

`leader TLDT + pairwise separation + reserved gap`

Cross-runway constraints are also applied.

User expectation: moving one aircraft later must push all affected followers later in real time.

## TEST TRAFFIC

TEST TRAFFIC is used heavily to verify lifecycle and drag behaviour when live IVAO traffic is absent.

Do not assume a bug is demo-only without checking whether the same React/runtime path is shared with live traffic.

The recent ETO flicker bug was visible in TEST because React changed the timeline time during TLDT drag before lifecycle code restored the locked value.

## Shared state / multi-controller / Return AUTO

Supabase is the durable shared operational store. The Cloudflare Realtime Worker broadcasts low-latency flight/sequence updates; the authenticated shared-state API and a 5-second poll remain the fallback/recovery path.

Important current rules:

- `src/sharedAmanRuntime.ts` is the only runtime that applies persisted MANUAL/AUTO flight targets to React rows.
- The old `manualTargetSyncCompatRuntime.ts` was removed. Do not recreate a second flight-target applier.
- `src/timelineReadableRuntime.ts` owns minute-only TLDT display formatting.
- Realtime revisions reject older updates and concurrent drags use a lease/ownership guard.
- A committed remote MANUAL/AUTO state is applied to React immediately in the same event turn; its synthetic pointer event must include `button: 0` so React accepts it as a left-button drag. Do not restore the preview and wait for the one-second recovery timer.
- A shared state received before its traffic row renders is retained and retried; reload/late-open behaviour has regression coverage.
- `aman:force-shared-refresh` triggers an immediate shared refresh after GA/reinsert and other explicit recompute paths.

Return AUTO means **current AUTO from one authoritative calculation**, not undoing to the exact pre-drag screen position:

- The browser performing Return AUTO calculates current AUTO TLDT, floor and runway.
- The result is persisted in `aman_flight_states` and broadcast so other/late-opening browsers use the same result.
- The fresh exact AUTO override expires after 60 seconds; the persisted floor remains to prevent returning into the past.
- Pre-MANUAL AUTO baseline fields remain available for audit/reference and are not the operational Return AUTO target.

Known deferred reliability issue: the local row currently changes to AUTO before the API write is confirmed. If the API fails, the display can temporarily disagree with the database until recovery. A future fix should show a pending state and either confirm on success or immediately restore MANUAL on failure.

## Traffic admission / lifecycle edge cases

- New eligible connected inbound flights are admitted automatically; no manual Insert should be required.
- IVAO phase updates can lag during pushback, so local movement/track evidence may infer departure before IVAO changes the phase label.
- Predeparture flights away from the destination remain visible, including same-airport flights before their first takeoff.
- Same-airport flights are considered completed only after track history proves takeoff and return/landing.
- Terminal LANDED / ON GROUND / ON BLOCKS flights must not be reinserted.
- Landed history deduplicates repeated observations while preserving the first ALDT.
- Final-approach/live state is isolated per airport so VTBD data cannot suppress or alter VTBS traffic and vice versa.

## Airport scope — EXPANSION PARKED

The production operational workspace currently supports VTBD and VTBS. Several frontend/runtime paths intentionally still use this two-airport scope.

Admin master data can create draft airports, runway flows and STAR mappings, but that does **not** make a new airport fully operational in AMAN. Full dynamic-airport support would require coordinated changes to frontend selection, shared/realtime rooms, landing history, runway geometry, flow/timing validation and tests.

The user explicitly parked this expansion on 2026-08-31. Do not generalize to every airport unless explicitly requested later.

## Responsive layout

- The timeline remains the primary surface on tablets, portrait/short screens and narrow desktop emulation.
- Inbound traffic is available through a compact/collapsible drawer on smaller displays, including iPad portrait and landscape breakpoints.
- Drag release keeps the strip at the release position until React commits the new TLDT, preventing the one-frame jump back to the old position.

## VTBS STAR nominal timing note

Current hardcoded VTBS nominal values remain a working model, not authoritative fixed AIP elapsed times.

Example current constants have included:

- NORTA STAR19 nominal = 20 min

Observed real sample retained for calibration:

- NORTA 06:21Z
- LETMA (20 NM final) 06:35Z
- touchdown 06:42:30Z
- NORTA -> touchdown = 21:30

One flight is not enough to recalibrate the nominal. Collect multiple flights and compare median/mean before changing.

Also remember feeder-fix ETA error and post-feeder nominal timing error are separate error sources.

## Admin / master data

Staff master data UI exists for:

- Fix Timing
- Runway Flow
- Airport

Main files:

- `src/StaffMasterDataAdmin.tsx`
- `src/staffMasterDataAdmin.css`
- `functions/api/admin/master.js`

Production MAESTRO now loads effective nominal fix timings through authenticated `/api/sequence/operational-config`.

- Only Active + Published airports/runway flows with `timing_status=ACTIVE` are exposed to the runtime.
- The newest active timing revision effective on the UTC service date wins for each airport/flow/fix.
- The frontend refreshes operational master timing every 60 seconds and on `aman:force-shared-refresh`.
- `src/core/amanConstants.ts` remains a non-destructive outage/missing-record fallback.
- The System panel reports `MASTER DATA` or `CODE FALLBACK` so controllers can see the active source.

CAAT review is available at `/?admin=caat`. It scans the effective CAAT eAIP, maps records to configured runway flows and requires explicit staff selection plus confirmation before audited import. When CAAT provides a valid Thailand ICAO and runway group that is missing from Master Data, the review marks it `DRAFT`; approval creates the missing airport and runway flow as Active but Not Published with Timing Pending, then links the STAR. It never invents timing or enables the workspace. A new effective-date STAR revision is inserted instead of overwriting the previous AIRAC revision.

CI uses the Node 24-based `actions/checkout@v5` and `actions/setup-node@v5` actions.

## Missed approach caution

There is historical implementation for direct missed-approach reinsertion. Desired semantics discussed later are:

- LANDED / ON GROUND / ON BLOCKS = flight is finished; GA action should not resurrect it
- Only a genuinely active/non-terminal missed approach should be reinserted, around NOW + 10 min with normal cascade

If touching this area, inspect current code first because older commits may still contain terminal-bypass behaviour.

## Recent commits relevant to current handoff

Newest behavioural work at handoff time (newest first):

- `cbd104f` — consolidate shared MANUAL/AUTO application into one runtime
- `6fac586` — persist and broadcast authoritative current AUTO returns
- `804f3f9` — persist the pre-MANUAL AUTO baseline for audit/reference
- `dd6dbce` — recompute traffic by selected airport instead of globally
- `2ae3a54` — prevent the one-frame drag-release jump/flicker
- `c4a6783` / `6196bb4` — keep timeline primary and add compact inbound handling on small screens
- `805af1c` — infer pushback/departure before delayed IVAO phase updates
- `7be011c` / `88d3944` — handle same-airport lifecycle and retain predeparture inbound flights
- `63ebbc0` — isolate final-approach data by airport
- `3309d58` / `1734230` — protect realtime revisions/concurrent drags and reconnect at UTC rollover
- `4fc2bdf` / `eddc65a` — lock stable ETA, deduplicate landed history and exclude automatic ETA shifts from controller delay
- `41c8ec4` — auto-admit new inbound traffic
- `e46e8a0` / `dcd5a0b` — immediate AUTO reset broadcast and realtime multi-controller synchronization

Earlier drag/lifecycle foundations that must remain intact include `777e3b1`, `758cdf3`, `32ac6f1`, `e72e7fb`, `cd6ada0`, `898a7d8`, `c0e7c04`, `3457590` and `6ea3b64`.

## Verification status and deferred work

As of this handoff:

- Vitest: 15 files, 125 tests passing
- TypeScript build: passing
- Vite production build: passing
- `main` was clean and synchronized with `origin/main` before this documentation edit

Deferred by user:

1. Return AUTO API-failure pending/rollback behaviour.
2. Real browser E2E coverage (two controllers, late open, reconnect, mouse/touch and responsive devices).
3. Full operational support for airports beyond VTBD/VTBS.

## What to do when continuing in Codex

First prompt recommendation:

> Read `CODEX_HANDOFF.md`, inspect current `main`, especially `src/AppMaestroV24.tsx`, `src/sharedAmanRuntime.ts`, `src/realtimeAmanRuntime.ts`, `src/interactionGuardRuntime.ts`, `src/manualSequenceReorderRuntime.ts`, `src/timelineDisplayScaleRuntime.ts`, `src/etaFfLifecycleRuntime.ts`, and `src/finalTenNmRuntime.ts`. Preserve all stated operational semantics. Before editing, tell me what behaviour the current code actually implements and identify any mismatch with the handoff.

For code changes, prefer small targeted edits and verify the actual runtime path. Avoid broad refactors unless required.
