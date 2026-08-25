# Codex Handoff — ATC Arrival Sequencing / Thailand AMAN

Last updated: 2026-08-25
Repository: `zporporz/arrival-sequencing`
Production: `https://atc-sequence.pages.dev`
Supabase project: `jamwzmqcerkivkgpezfh`

## Start here

Before changing anything, inspect current `main`. This handoff describes the intended behaviour and the latest work, but current code is the source of truth for exact implementation details.

Do not delete or reset shared operational data, especially `aman_flight_states`.

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

### High-risk area to verify before future reorder changes

`applyManualTargetsWithCascade()` in `src/AppMaestroV24.tsx` historically finishes by sorting rows by TLDT and assigning `sequenceIndex = index + 1`. This can conceptually conflict with the rule above. Inspect current behaviour carefully before editing. If this still causes hidden order changes, fix the distinction between render chronology and explicit sequence rank rather than deriving rank from TLDT.

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

Newest behavioural work at handoff time:

- `777e3b1c7c3d3296ada07126cbf0486ecfd824ba` — move cascaded flight boxes during live drag
- `758cdf389b8e3f338d2d75f36655b358298da8ee` — upward TLDT drag is live push-only; downward keeps replace
- `32ac6f19160deb12d43763ff51de8aff53aa6758` — prevent locked ETO flicker during TLDT drag
- `e72e7fba24d48a0de8eb82d9f250500e1cd3e028` — install 10 NM final runtime
- `cd6ada018bd5e2cbcffac9ae47465cb1cd347744` — Frozen uses 10 NM final with 4-min fallback
- `898a7d8399868ac85d2afaeb1d507119aa26aa22` — live 10 NM final detector
- `2cc154892519a7224d55ac66a28c226e2f27063e` — latch sequence order / upward preview-era fix
- `c0e7c04dc786d2b20b096b38ea0ded469154fa93` — remove TLDT hard locks from lifecycle
- `3457590308e8ea3a0c9e455eb32a37b0ea13d693` — pointer-capture cleanup after reorder
- `6ea3b645b36faf8dbbd90e099009eec48662d7b6` — latch DEPARTING stage until airborne

## What to do when continuing in Codex

First prompt recommendation:

> Read `CODEX_HANDOFF.md`, inspect current `main`, especially `src/AppMaestroV24.tsx`, `src/manualSequenceReorderRuntime.ts`, `src/timelineDisplayScaleRuntime.ts`, `src/etaFfLifecycleRuntime.ts`, and `src/finalTenNmRuntime.ts`. Preserve all stated operational semantics. Before editing, tell me what behaviour the current code actually implements and identify any mismatch with the handoff.

For code changes, prefer small targeted edits and verify the actual runtime path. Avoid broad refactors unless required.
