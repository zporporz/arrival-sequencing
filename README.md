# Bangkok FIR Arrival Sequencing

AMAN / MAESTRO-style arrival sequencing prototype for IVAO Thailand.

**Production:** https://atc-sequence.pages.dev  
**Current focus:** Approach arrival sequencing for **VTBD / VTBS**

> Prototype / training decision-support only. It does not replace ATC procedures, separation minima, local instructions, or controller judgement.

---

## Current status — 18 Aug 2026

**Overall: Approach-side prototype is roughly 60–70% complete.**

### ✅ Working now

- IVAO SSO login.
- Live IVAO inbound traffic.
- Pure VFR flights filtered out.
- Filed-route + AIRAC geometry processing.
- Automatic IAWP / feeder-fix mapping.
- Live ETA prediction to IAWP.
- Fallback timing from tracked/actual departure + EET.
- MAESTRO-style vertical timeline.
- 1-minute / 5-minute time ticks.
- Adjustable minutes shown below ACTUAL line.
- Automatic arrival sequencing.
- TLDT / TTO / Delay Required calculation.
- Delay colours:
  - Expedite
  - Nothing
  - Speed reduction
  - Path stretching
  - Holding
- Drag aircraft to change target landing time.
- Manual TLDT remains fixed while live prediction continues updating.
- Cascade sequencing: later aircraft are pushed instead of being allowed to overlap.
- Flight status:
  - Unstable
  - Stable
  - Superstable
  - Frozen
- Multiple active arrival runways.
- Runway mode: ARR / DEP / MIX / CLOSED.
- Configurable landing separation in NM per runway.
- Per-flight runway assignment.
- VTBS multi-runway stagger working rule: **1 minute between different arrival runways**.
- VTBD + VTBS can be displayed together.
- LEFT / RIGHT timeline side selection per airport.
- TEST TRAFFIC mode for sequencing tests.

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
```

### Manual sequencing rule

When ATC drags an aircraft:

- **TLDT / TTO become the controller target and stay fixed.**
- Live ETA prediction keeps updating.
- Delay Required is recalculated against the fixed target.

---

## Flight status

| Status | Working trigger |
|---|---|
| Unstable | Early / system-managed phase |
| Stable | ~15 min before predicted IAWP, or ATC manually sequences the flight |
| Superstable | ~5 min before predicted IAWP |
| Frozen | ~4 min before predicted landing / final phase |

Flight-status colour and Delay Required colour are separate.

AEROTHAI material identifies VTBD/VTBS MAESTRO operation and describes AMAN-to-AMAN coordination, VTBS 3-runway capability, Time to Lose/Gain at feeder fixes, Speed Advisory and Time to Leave Holding Fixes.

---

## ETA source priority

```text
1. Live route ETA
2. Tracked / actual departure + filed EET
3. EOBT + filed EET fallback
```

Live ETA uses:

- aircraft latitude / longitude;
- groundspeed;
- filed route;
- route geometry;
- mapped IAWP / feeder fix.

---

## 🚧 Still in progress

- Holding detection and HLD counter.
- Time to Leave Holding Fixes.
- Late-connect / late-spawn resequencing warnings.
- Better automatic runway assignment / gate preference.
- Aircraft-specific / wake-specific separation rules.
- Go-around / emergency / priority handling.
- Runway-closure handling.
- Persistence / realtime sharing of new AMAN controller targets.
- More airports beyond VTBD / VTBS.
- HMI cleanup / responsive layout.
- More validation against Thai operational references.

---

## Tech

- React + TypeScript + Vite
- Cloudflare Pages Functions
- IVAO Tracker / flight-plan data
- AIRAC route geometry
- Supabase/PostgreSQL retained for later persistence

---

## Current development priority

**Approach-side AMAN first.**

Centre-side supporting panels and legacy workflow screens are not the current priority.
