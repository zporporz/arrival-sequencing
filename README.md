# Bangkok FIR Arrival Sequencing

AMAN / MAESTRO-style arrival sequencing prototype for IVAO Thailand.

**Production:** https://atc-sequence.pages.dev  
**Current focus:** Approach arrival sequencing for **VTBD / VTBS**

> Prototype / training decision-support only. It does not replace ATC procedures, separation minima, local instructions, or controller judgement.

---

## Current status — 19 Aug 2026

**Approach-side core is implemented and ready for live operational testing.**

---

# Features

## Part 1 — Live traffic & prediction

What it does:

- IVAO SSO login.
- Reads live inbound traffic for VTBD / VTBS.
- Filters pure VFR traffic out.
- Reads filed route and AIRAC geometry.
- Maps aircraft to the applicable IAWP / feeder fix.
- Calculates predicted time at IAWP.
- Uses live route prediction when available.
- Falls back to actual/tracked departure + filed EET, then EOBT + EET.
- Browser traffic refresh: **30 sec**.
- Whazzup backend cache: **15 sec**.

---

## Part 2 — Arrival timeline

What it does:

- MAESTRO-style vertical time axis.
- Fixed red **ACTUAL** line.
- 1-minute minor ticks and 5-minute major ticks.
- Select how many minutes are shown below ACTUAL.
- Aircraft labels move with time while ACTUAL stays fixed.
- VTBD / VTBS can be shown on LEFT or RIGHT side of the same timeline.

---

## Part 3 — Automatic sequencing

What it does:

- Automatically creates a landing sequence.
- Calculates:
  - **TLDT** — Target Landing Time.
  - **TTO** — Target Time Over IAWP / feeder fix.
  - **Delay Required**.
- Prevents landing targets from overlapping configured spacing.
- Cascade drag: moving one aircraft can push following aircraft while maintaining spacing.
- Manual gain is limited to **5 minutes earlier than the natural prediction**.
- Double-click returns an aircraft to its current AUTO target.

---

## Part 4 — Flight status

Callsign colour shows the MAESTRO lifecycle:

- **Unstable — cyan**: early planning phase.
- **Stable — orange**: approximately 15 min before predicted IAWP.
- **Superstable — white**: approximately 5 min before predicted IAWP.
- **Frozen — violet**: approximately 4 min before predicted landing / short-final fallback.

Manual target ownership and flight lifecycle are separate concepts.

---

## Part 5 — Multi-runway / multi-airport

What it does:

- Multiple arrival runways can operate at the same time.
- Runway modes:
  - ARR
  - DEP
  - MIX
  - CLOSED
- LAND SEP can be configured in NM per runway.
- Each aircraft can be manually assigned a landing runway.
- VTBD + VTBS can be operated on the same AMAN timeline.
- VTBS working cross-runway rule: **1 minute minimum between different arrival runways**.

Current baseline:

| Airport | Runway | LAND SEP |
|---|---|---:|
| VTBD | 21R | 5.0 NM |
| VTBD | 21L | 7.1 NM |
| VTBS | 19 | 5.5 NM |
| VTBS | 20L | 8.0 NM |
| VTBS | 20R | 6.0 NM |

---

## Part 6 — Time to Lose / Gain & delay action

What it does:

- Continuously compares predicted IAWP time with TTO.
- Delay Required updates while the aircraft moves.
- Action categories:
  - Expedite
  - Nothing
  - Speed reduction
  - Path stretching
  - Holding

Current numeric thresholds are project working values pending Thailand confirmation.

---

## Part 7 — Speed advisory

What it does:

- Calculates a planning groundspeed when a speed-only solution appears feasible.
- Displays `GS~xxx` for a suggested planning groundspeed.
- Displays `SPD+PATH` when speed alone is insufficient.

This is a project planning-groundspeed model, **not a claim of MAESTRO's internal IAS/Mach algorithm**.

---

## Part 8 — Holding / Time to Leave Holding Fix

What it does:

- Detects when delay reaches the Holding action threshold.
- HLD counter shows current holding demand.
- Uses STAR entry / IAWP as the working holding point model.
- Displays `LEAVE HH:MM` from the target TTO.
- Delay-cell double-click can toggle shared HOLD / NO HOLD override.

---

## Part 9 — Shared realtime & persistence

What it does:

- Supabase shared AMAN state for all connected controllers.
- Manual TLDT persists after refresh.
- Manual landing runway persists after refresh.
- Return-to-AUTO is shared.
- Runway profile, runway mode and LAND SEP are shared.
- Supabase Realtime propagates changes to other controllers.
- Shows who is currently online on the website.
- System panel reports shared-state health.

---

## Part 10 — Disconnect / reconnect recovery

What it does:

- Flight identity is not tied only to one IVAO session ID.
- If a pilot disconnects, the sequence slot becomes a **GHOST** instead of disappearing immediately.
- Ghost slot is retained for up to **30 minutes**.
- Reconnect restores the same target / runway / manual state where possible.
- Uses VID, flight identity, position, elapsed time and groundspeed to assess reconnect plausibility.
- Shows:
  - `RECONNECTED`
  - `POSITION JUMP`
  - Ghost count
- Recovery state is shared across controllers.

---

## Part 11 — Planning Horizon / Not Yet in Sequence

What it does:

- Not every distant inbound is immediately inserted into the landing sequence.
- Current working planning horizon: **40 minutes to predicted IAWP**.
- Aircraft outside the horizon remain visible in Inbound as **MON** / monitored traffic.
- They enter active sequencing when they move inside the planning horizon.

The 40-minute value is currently a project working setting and can be made configurable later.

---

## Part 12 — Late insert / resequence protection

What it does:

- Detects aircraft that appear late and would need to be inserted into an already-established sequence.
- Does **not silently resequence established traffic**.
- Shows a `LATE / INSERT` indication first.
- ATC explicitly accepts insertion before the aircraft joins the active sequence.

This is intended to protect an existing plan from unexpected IVAO late-connect / late-spawn traffic.

---

## Part 13 — Pairwise separation engine

What it does:

- Same-runway spacing can depend on the leader/follower aircraft pair instead of runway LAND SEP alone.
- LAND SEP remains the minimum baseline.
- Current project working special values include:
  - A380-related spacing: at least **3 min**.
  - ATR-related spacing: at least **4 min**.

These pairwise values are working project rules and still require Thailand operational confirmation before being treated as authoritative local minima.

---

## Part 14 — Test / system tools

What it does:

- TEST TRAFFIC mode for sequencing tests without waiting for live arrivals.
- System health drawer shows items such as:
  - LIVE / SIMULATED data mode.
  - Shared AMAN sync.
  - Live route ETA coverage.
  - Separation invariant.
  - Holding / Speed Advisory state.
  - Ghost / reconnect state.
- Online controller presence.

Verification checklist:

`docs/AMAN_FOUR_CORE_VERIFICATION.md`

---

# Timing model

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

- TLDT / TTO become the controller target.
- Live prediction continues updating.
- Delay Required and advisories update against that target.
- Double-click removes the manual target and returns the aircraft to AUTO sequencing.

---

# Still to do

## Operational behaviour

- Runway-configuration transition / runway change handling.
- Go-around / missed-approach behaviour — exact Thailand MAESTRO workflow not yet confirmed.
- Conformance monitoring / target-at-risk indication.
- Data-confidence indication for ETA quality.
- Multi-controller simultaneous-edit conflict handling.
- Undo / audit history.
- What-if sequence planning.
- Capacity / slot management.

## Validation

- Two-controller simultaneous testing.
- Real pilot disconnect / reconnect testing.
- Heavy traffic test with 20–40 arrivals.
- Midnight UTC service-date rollover test.
- Further responsive HMI cleanup.
- Validate project working values against Thailand operational references:
  - delay action thresholds;
  - VTBS cross-runway stagger;
  - runway LAND SEP;
  - STAR nominal timings;
  - pairwise ATR / A380 rules;
  - final-position Frozen detector.

## Later phase

- More airports beyond VTBD / VTBS.
- E-AMAN / wider upstream metering.
- Coordinated multi-airport / CMAN logic.
- AMAN–DMAN integration.

---

# Tech

- React + TypeScript + Vite
- Cloudflare Pages Functions
- IVAO Tracker / flight-plan data
- AIRAC route geometry
- Supabase / PostgreSQL
- Supabase Realtime

---

## Scope

Current priority remains **Approach-side arrival sequencing**. Centre-side supporting panels and departure-management functions are later phases.
