# Bangkok FIR Arrival Sequencing

AMAN / MAESTRO-style arrival sequencing prototype for IVAO Thailand.

**Production:** https://atc-sequence.pages.dev  
**Current focus:** Approach arrival sequencing for **VTBD / VTBS**

> Prototype / training decision-support only. It does not replace ATC procedures, separation minima, local instructions, or controller judgement.

---

## Current status — 19 Aug 2026

**Approach-side core is now implemented for live operational testing.**

### ✅ Working now

#### Live traffic and prediction

- IVAO SSO login.
- Live IVAO inbound traffic with pure VFR traffic filtered out.
- Filed-route + AIRAC geometry processing.
- Automatic IAWP / feeder-fix mapping.
- Live ETA prediction to IAWP.
- Fallback timing from tracked/actual departure + filed EET.
- 30-second browser traffic refresh with 15-second Whazzup cache.

#### Timeline and sequencing

- MAESTRO-style vertical timeline.
- Fixed ACTUAL line with 1-minute and 5-minute ticks.
- Adjustable history below the ACTUAL line.
- Automatic arrival sequencing.
- TLDT / TTO / Delay Required calculation.
- Delay action classes:
  - Expedite
  - Nothing
  - Speed reduction
  - Path stretching
  - Holding
- Drag aircraft to set a manual TLDT.
- Manual TLDT remains fixed while live prediction continues updating.
- Cascade constraints push later aircraft instead of allowing overlapping landing targets.
- Double-click returns the flight target to AUTO.

#### Flight lifecycle

- Unstable.
- Stable — approximately 15 minutes before predicted IAWP.
- Superstable — approximately 5 minutes before predicted IAWP.
- Frozen — approximately 4 minutes before predicted landing, with a live final-position fallback.
- AUTO / MANUAL target ownership is separate from flight lifecycle colour.

#### Multi-airport / multi-runway

- Multiple active arrival runways.
- Runway mode: ARR / DEP / MIX / CLOSED.
- Configurable LAND SEP in NM per runway.
- Per-flight landing-runway assignment.
- VTBS working multi-runway stagger: **1 minute between different arrival runways**.
- VTBD + VTBS on a common time axis.
- LEFT / RIGHT timeline-side selection per airport.

#### Holding / Time to Leave Holding Fix

- Automatic Holding classification at the configured delay threshold.
- HLD counter.
- Holding point model at the STAR entry / IAWP.
- `LEAVE HH:MM` advisory derived from TTO.
- Shared HOLD / NO HOLD override by double-clicking the Delay Required value.

#### Speed advisory

- Planning groundspeed advisory for Speed Reduction and Expedite conditions.
- Displayed as `GS~xxx` when a speed-only solution is feasible.
- Displays `SPD+PATH` when speed alone cannot absorb the required time.
- This is a prototype planning-groundspeed estimate, not a claim of the installed MAESTRO's internal IAS/Mach algorithm.

#### Shared realtime and persistence

- Shared Supabase state per UTC service date and airport.
- Manual TLDT and landing runway persist across refreshes.
- Return-to-AUTO is shared.
- Runway profile, runway modes and LAND SEP are shared.
- Supabase Realtime propagates changes to connected controllers.
- System drawer reports Shared AMAN health.
- Global website presence shows controllers currently online.

#### Shared reconnect recovery

- Server-side canonical flight identity independent of a new IVAO session ID.
- A disconnected flight retains its slot as a GHOST for up to **30 minutes**.
- Reconnect restores the same TLDT, runway and manual target state.
- Position plausibility uses last/new position, elapsed time and groundspeed.
- Shared `RECONNECTED` and `POSITION JUMP` warnings are visible to all controllers.

#### Test support

- TEST TRAFFIC mode for sequencing, drag, multi-runway and status tests.
- Four-core verification checklist: `docs/AMAN_FOUR_CORE_VERIFICATION.md`.

---

## Airport baseline

### VTBD

| Runway | Default LAND SEP |
|---|---:|
| 21R | 5.0 NM |
| 21L | 7.1 NM |

### VTBS

| Runway | Default LAND SEP |
|---|---:|
| 19 | 5.5 NM |
| 20L | 8.0 NM |
| 20R | 6.0 NM |

Example VTBS configuration:

```text
SEMI35_19MIX_20LDEP_20RARR
```

---

## Timing model

```text
Live position + route + groundspeed
              ↓
        Predicted IAWP
              ↓
     + nominal STAR time
              ↓
      Natural landing ETA
              ↓
        Sequencing rules
              ↓
             TLDT
              ↓
     - nominal STAR time
              ↓
             TTO
              ↓
 Delay / speed / holding advisory
```

When ATC sets a manual target:

- **TLDT / TTO remain fixed.**
- Live ETA prediction continues updating.
- Delay Required and advisories are recalculated against the fixed target.

---

## 🚧 Remaining work

The four main AMAN blocks are implemented; remaining work is mainly validation and operational refinement:

- Two-controller conflict and simultaneous-edit testing.
- Live disconnect/reconnect testing with real IVAO traffic.
- Heavy-traffic testing with 20–40 arrivals.
- Midnight UTC/service-date rollover testing.
- Further HMI and responsive-layout cleanup.
- Validation of working local values against Thailand operational sources:
  - delay colour thresholds;
  - VTBS cross-runway stagger;
  - runway LAND SEP values;
  - STAR nominal times;
  - final-position Frozen detector.
- Exact MAESTRO Speed Advisory algorithm remains unknown from the available public material.
- More airports beyond VTBD / VTBS.

Features not yet claimed as confirmed Thailand MAESTRO behaviour include gate-based runway assignment, pairwise wake sequencing, and dedicated go-around/emergency/priority workflows.

---

## Tech

- React + TypeScript + Vite
- Cloudflare Pages Functions
- IVAO Tracker / flight-plan data
- AIRAC route geometry
- Supabase/PostgreSQL
- Supabase Realtime

---

## Development scope

The current product remains focused on **Approach-side arrival sequencing**. Centre-side supporting panels and legacy spreadsheet-style workflow screens are outside the current priority.
