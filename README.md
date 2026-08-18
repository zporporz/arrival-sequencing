# Bangkok FIR Arrival Sequencing

Prototype Arrival Manager / AMAN-style sequencing tool for IVAO Thailand, currently focused on **Approach arrival sequencing** for VTBD and VTBS.

**Production:** https://atc-sequence.pages.dev  
**Repository:** `zporporz/arrival-sequencing`

> This project is a training/prototype decision-support tool. It does not replace applicable ATC procedures, separation minima, local instructions, or controller judgement.

---

## Current project status — 18 Aug 2026

The old sequencing frontend was reset and the current application is being rebuilt around a MAESTRO/AMAN-style timeline for Approach controllers.

The project is now past the basic UI/proof-of-concept stage. The current build already has a working live-traffic pipeline, sequencing engine, controller drag interaction, multi-runway configuration, and multi-airport timeline display. It is still a prototype and is not yet feature-complete.

### Working now

- IVAO SSO authentication and existing backend/API infrastructure are preserved.
- Live IVAO inbound traffic for VTBD and VTBS.
- Pure VFR flights are filtered out of the AMAN feed.
- Filed route + AIRAC route-geometry resolution.
- Automatic IAWP / feeder-fix mapping from filed routes.
- Live ETA estimation to the IAWP using aircraft position, route geometry and groundspeed.
- Fallback ETA logic using actual/tracked departure and filed EET when live-route ETA is not available.
- MAESTRO-style vertical time axis with:
  - fixed ACTUAL/current-time line;
  - 1-minute minor ticks;
  - 5-minute major ticks;
  - selectable minutes shown below the ACTUAL line.
- Automatic arrival sequencing by TLDT.
- TTO / delay-required calculation.
- Delay advisory colour states:
  - expedite;
  - nothing;
  - speed reduction;
  - path stretching;
  - holding.
- Controller drag-to-sequence interaction.
- Dragged/manual targets remain fixed while live prediction continues updating.
- Cascade-constrained sequencing: dragging one aircraft can push later aircraft instead of allowing overlapping landing targets.
- Flight status model:
  - Unstable;
  - Stable;
  - Superstable;
  - Frozen.
- Manual controller action can promote a flight to Stable while later status transitions continue automatically.
- Multiple active arrival runways per airport.
- Per-runway operating mode:
  - ARR;
  - DEP;
  - MIX;
  - CLOSED.
- Per-runway configurable landing spacing in NM.
- Per-flight landing-runway override when more than one arrival runway is active.
- VTBS working multi-runway rule: landing targets on different active arrival runways are staggered by at least 1 minute.
- Airport display side selection (LEFT / RIGHT) for the common timeline.
- VTBD and VTBS can be displayed simultaneously on opposite sides of the same time axis.
- Built-in simulated TEST TRAFFIC for sequencing and drag tests.

### Current airport configuration baseline

#### VTBD

- RWY 21R default landing spacing: **5.0 NM**
- RWY 21L default landing spacing: **7.1 NM**
- Multi-arrival configurations supported.

#### VTBS

- RWY 19 default landing spacing: **5.5 NM**
- RWY 20L default landing spacing: **8.0 NM**
- RWY 20R default landing spacing: **6.0 NM**
- Example profile: `SEMI35_19MIX_20LDEP_20RARR`
- Three-runway operation is supported in the prototype.

---

## Timing model

For each arrival, the working model is:

```text
live aircraft position / route / groundspeed
                    ↓
          predicted time at IAWP
                    ↓
       + nominal STAR / feeder time
                    ↓
         natural landing estimate
                    ↓
     sequencing / runway constraints
                    ↓
                 TLDT
                    ↓
      - nominal STAR / feeder time
                    ↓
                 TTO
```

The controller target and the live prediction are deliberately separate:

- **Prediction** continues to update from live traffic.
- **TLDT / TTO set by ATC** remain fixed after manual sequencing.
- **Delay Required** is recalculated as the live prediction changes against the controller target.

This prevents a manually sequenced aircraft from drifting away from the slot the controller assigned.

---

## Flight status model

The current prototype follows the MAESTRO flight-status concept:

- **Unstable** — early/system-managed phase.
- **Stable** — approximately 15 minutes before predicted IAWP, or earlier if manually sequenced by ATC.
- **Superstable** — approximately 5 minutes before predicted IAWP.
- **Frozen** — approximately 4 minutes before predicted landing / final phase.

Status colour and delay colour are separate concepts in the UI.

Reference material from AEROTHAI identifies VTBS/VTBD as operational MAESTRO airports and lists AMAN-to-AMAN coordination, VTBS 3-runway capability, Time to Lose/Time to Gain at feeder fixes, Speed Advisory, and Time to Leave Holding Fixes as supported functions.

---

## ETA / IAWP logic

The ETA engine does not rely on filed EOBT alone because IVAO departures may not occur at the filed time.

Current source priority is approximately:

```text
LIVE ROUTE ETA
   ↓
tracked / actual departure + filed EET
   ↓
EOBT + filed EET fallback
```

For live route ETA the tool uses:

- current latitude / longitude;
- current groundspeed;
- filed route;
- parsed route geometry;
- mapped IAWP / feeder fix.

The closer the aircraft gets to the feeder fix, the more useful the prediction becomes for sequencing.

---

## Multi-runway sequencing

The sequencing engine treats each active landing runway as its own constrained stream.

Same-runway aircraft are constrained by the configured landing spacing. When a manual change would violate spacing, later traffic is moved instead of allowing the sequence to overlap.

VTBS currently also applies a project working rule of **1 minute minimum stagger between landing targets on different active arrival runways**. This value is a prototype rule and can be made configurable later.

Per-flight runway assignment can be changed by the controller while the runway remains ARR or MIX.

---

## Multi-airport display

The common timeline can show VTBD and VTBS together.

Each selected airport can be assigned to:

- LEFT side of the time axis; or
- RIGHT side of the time axis.

The timeline uses one shared UTC/current-time reference while each airport keeps its own runway configuration and sequence constraints.

---

## Test mode

`TEST TRAFFIC` injects simulated arrivals through the same sequencing engine used by live traffic.

It is intended to test:

- timeline movement;
- automatic sequencing;
- delay colours;
- drag behaviour;
- cascade movement;
- manual Stable state;
- runway reassignment;
- multi-runway spacing;
- VTBD / VTBS dual-airport display.

---

## Still in progress

Main items not yet complete:

- Holding detection / HLD counter and holding workflow.
- Time to Leave Holding Fixes logic.
- Late-spawn / late-connect arrival warnings and controller resequencing alerts.
- More complete automatic runway assignment logic, including gate/parking preference.
- Production-quality pairwise wake / aircraft-specific spacing logic (ATR, A380, etc.).
- Go-around, emergency, priority and runway-closure handling.
- Controller persistence / shared manual targets in the new AMAN model.
- Expanded airport support beyond the current VTBD / VTBS implementation.
- Final HMI cleanup and responsive layout tuning.
- Further validation against Thai operational references and controller feedback.

---

## Architecture

### Frontend

- React
- TypeScript
- Vite

### Backend / data

- Cloudflare Pages Functions
- IVAO Tracker / flight-plan data
- AIRAC route parser / route geometry
- Existing Supabase/PostgreSQL infrastructure retained for later persistence work

### Live flow

```text
IVAO traffic
   ↓
flight plan + live track
   ↓
IAWP mapping
   ↓
route geometry
   ↓
ETA prediction
   ↓
runway assignment
   ↓
constraint sequencing
   ↓
Approach AMAN timeline
```

---

## Reference direction

Primary implementation direction is based on Thai operational material where available, especially AEROTHAI MAESTRO material for Bangkok ACC. ICAO / foreign AMAN references are used only where local details are not available or still need confirmation.

AEROTHAI's MAESTRO material shows:

- VTBS / VTBD in operation;
- AMAN-to-AMAN coordination;
- VTBS 3-runway operation capability;
- Time to Lose / Time to Gain at feeder fixes;
- Speed Advisory;
- Time to Leave Holding Fixes when necessary;
- flight status progression from Unstable to Stable, Superstable and Frozen.

---

## Development note

The current focus is **Approach-side arrival sequencing**. Centre-side supporting panels and other legacy workflow screens are intentionally not the priority during this rebuild.
