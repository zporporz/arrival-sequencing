# Bangkok FIR Arrival Sequencing

AMAN / MAESTRO-style arrival sequencing prototype for IVAO Thailand.

**Production:** https://atc-sequence.pages.dev  
**Current focus:** Approach arrival sequencing for **VTBD / VTBS**

> Prototype / training decision-support only. It does not replace ATC procedures, separation minima, local instructions, or controller judgement.

---

## Current status — 19 Aug 2026

**Approach-side AMAN core is implemented and is being aligned to the latest Thai MAESTRO knowgood.**

Primary project reference for current behavior: `research/aman/MAESTRO_V24_KNOWGOOD.md`.

---

# Features

## Part 1 — Live traffic, ETA-FF & prediction

- IVAO SSO login.
- Live VTBD / VTBS inbound traffic; pure VFR filtered out.
- Filed route + AIRAC geometry.
- Automatic IAWP / Feeder Fix mapping.
- Predicted **ETA-FF** from live route/position when available.
- Fallback from actual/tracked departure + filed EET, then EOBT + EET.
- Browser ETA-FF / traffic refresh: **15 sec**.
- Whazzup backend cache: **15 sec**.

## Part 2 — MAESTRO processing radius

- Latest Thai MAESTRO material describes processing coverage of roughly **200–300 NM**.
- Project active-sequence admission uses the outer **300 NM** boundary.
- Destination traffic outside 300 NM remains visible as **MON** but does not enter the active landing sequence.
- When traffic crosses into the processing boundary, it becomes eligible for active sequencing.
- The older AEROTHAI status reference independently places Unstable traffic at roughly **300–200 NM**.

## Part 3 — Arrival timeline

- MAESTRO-style vertical time axis.
- Fixed red **ACTUAL** line.
- 1-minute minor / 5-minute major ticks.
- Configurable minutes displayed below ACTUAL.
- Traffic labels move with time while ACTUAL stays fixed.
- VTBD / VTBS can be placed LEFT or RIGHT on one timeline.
- TEST TRAFFIC anchor is normalized to an exact UTC minute so displayed STA/TLDT labels align with the minute grid.
- Timeline rows show STA/TLDT with seconds (`HH:MM:SS`) so visual position and displayed time use the same precision.

## Part 4 — Automatic sequencing

- Automatic landing sequence.
- Calculates project-compatible target names:
  - **STA / TLDT** — target landing time.
  - **STA-FF / TTO** — target Feeder Fix crossing time.
  - **TDLY** — total delay required.
- Cascade constraints prevent target overlap.
- Drag to set a manual target.
- Manual gain has no fixed five-minute cap; controllers may set an earlier target for coordinated shortcut / expedite actions, while runway and sequence separation constraints still apply.
- Double-click returns the aircraft to AUTO target.

## Part 5 — Flight lifecycle

Callsign colour:

- **Unstable — cyan**.
- **Stable — orange**: approximately 15 min before predicted IAWP/Feeder Fix.
- **Superstable — white**: approximately 5 min before predicted IAWP/Feeder Fix.
- **Frozen — violet**: approximately 4 min before predicted landing, with short-final position fallback.

AUTO / MANUAL target ownership remains separate from lifecycle.

## Part 6 — Multi-runway / multi-airport

- Multiple active arrival runways.
- Runway modes: ARR / DEP / MIX / CLOSED.
- Configurable LAND SEP in NM.
- Manual per-flight runway assignment.
- Automatic runway allocation chooses the earliest feasible active arrival runway and uses runway load as a tie-break.
- VTBD + VTBS can operate on the same shared timeline.
- **VTBD dual-arrival sequencing is airport-wide:** aircraft on 21R and 21L may not land simultaneously. For cross-runway pairs, the required base separation is taken from the **follower's landing runway**.
  - 21L → 21R uses the configured 21R LAND SEP.
  - 21R → 21L uses the configured 21L LAND SEP.
- **VTBS cross-runway sequencing** keeps the current project working stagger of **1 minute** between different active arrival runways, before applying any larger follower-specific special minimum.

Current spacing baseline:

| Airport | Runway | LAND SEP |
|---|---|---:|
| VTBD | 21R | 5.0 NM |
| VTBD | 21L | 7.1 NM |
| VTBS | 19 | 5.5 NM |
| VTBS | 20L | 8.0 NM |
| VTBS | 20R | 6.0 NM |

## Part 7 — Delay Splitting: TDLY / EDLY / ADLY

Thai MAESTRO material defines:

- **EDLY** — En-route Delay absorbed before the Feeder Fix.
- **ADLY** — Approach Delay absorbed after the Feeder Fix.

The operational matrix implies a working 4-minute Approach delay budget, therefore the project displays:

`TDLY = EDLY + ADLY`

For negative delay, the HMI displays **GAIN** instead.

## Part 8 — Thai operational quick-reference matrix

The current HMI applies the source-backed matrix:

| TDLY | EDLY | Primary action | Secondary action | Vector limit |
|---:|---:|---|---|---|
| 6 | 2 | Permit Entry | Reduce Speed | <25 NM |
| 7 | 3 | Orbit / Permit | Assess inner traffic | ~30 NM |
| 8 | 4 | Consider Hold | Runway change | Max Limit |
| >=9 | >=5 | HOLD ALL | Issue EAT (STA-FF) | OVERLOAD |

The runway selector is highlighted at the `TDLY 8` band because runway change is listed as the secondary action.

## Part 9 — Speed / path / holding advisory

- Negative delay: expedite / shortcut / speed-up concept.
- Zero delay: normal flight.
- Positive delay: speed reduction / path stretching / holding progression.
- Planning GS advisory shows `GS~xxx` when a speed-only solution appears feasible.
- `SPD+PATH` when speed alone is insufficient.
- HLD counter.
- `LEAVE HH:MM` / EAT-style Feeder Fix release indication for holding traffic.
- Shared HOLD / NO HOLD override.

The planning-GS calculation is a project estimate, not a claim of MAESTRO's internal IAS/Mach algorithm.

## Part 10 — Capacity / demand

- Next-60-minute arrival demand is calculated per selected airport.
- Thai VTBS knowgood shows **ARR 37 MAX**; VTBS HMI capacity is capped at 37 arrivals/hour.
- No equivalent authoritative VTBD maximum is in the current deck, so VTBD capacity remains an estimate from configured landing spacing.
- OVERLOAD is highlighted when demand exceeds displayed capacity or the MAESTRO delay matrix enters the `>=9` HOLD ALL band.

## Part 11 — Late insert / resequence protection

- Detects traffic entering the processing boundary late enough to disrupt an established sequence.
- Does not silently insert it into an existing plan.
- Shows `INSERT` in Inbound first.
- ATC explicitly accepts insertion before resequencing.

This also covers common IVAO late-connect / late-spawn behavior.

## Part 12 — Landing separation model

LAND SEP is treated as a landing-sequence constraint rather than a wake rule tied to the leader.

### Follower-based special minima

Special values belong to the **aircraft that is landing next**:

- If the **follower is ATR / AT7x**, required separation is at least **4 min**.
- If the **follower is A380 / A388 / wake J**, required separation is at least **3 min**.
- If ATR or A380 is the leader and the following aircraft is a normal type, the following aircraft returns to its normal runway/cross-runway rule.

The engine therefore applies:

`required separation = MAX(base rule for follower, follower special minimum)`

### Same-runway

- Base rule = configured LAND SEP of the follower's runway, converted using the project reference speed.
- Follower ATR/A380 special value can increase that requirement.

### VTBD cross-runway

- 21R and 21L are one airport-wide arrival sequence.
- Aircraft cannot receive simultaneous landing targets on the two arrival runways.
- Base rule for a cross-runway pair = configured LAND SEP of the **follower runway**.
- Example with a 4 NM 21R setting and 7.1 NM 21L setting:
  - `21L → 21R` = 21R rule (4 NM), unless follower special is larger.
  - `21R → 21L` = 21L rule (7.1 NM), unless follower special is larger.

### VTBS cross-runway

- Different-runway base rule = **1 minute** current project working value.
- Follower ATR/A380 special minimum can increase the 1-minute stagger.
- Same-runway traffic continues to use the configured runway LAND SEP.

These local working values still require authoritative Thailand operational validation.

## Part 13 — MAESTRO operational actions

The uploaded Thai MAESTRO menu confirms functions including Change runway, Missed Approach, Insert arrival flight, Insert closure, Insert gap, Extra Flight, Dsequence and Remove.

Current implemented baseline:

- **Change runway** — per-flight runway selector.
- **Insert closure** — runway `CLOSED` mode in the runway configuration.
- **Missed Approach** — right-click flight → removes it from active sequence; it remains in Inbound for explicit REINSERT.
- **Dsequence** — right-click flight → removes it from active sequence; explicit REINSERT available.
- **Insert gap** — right-click flight → reserve +1 or +2 minutes after it; following traffic cascades and the gap is shared.
- **Remove** — excludes the live flight from active sequence; REINSERT remains available while it is still connected.

Confirmed menu items whose exact field/workflow is not yet documented enough to copy safely remain unimplemented instead of guessed: Change trajectory, Change Metering Fix, Change ETA-FF, Maximum Delay, MF constraint, Transfer Speed, FF Transfer constraints, Coordination and Extra Flight.

## Part 14 — Shared realtime & persistence

- Supabase shared state for connected controllers.
- Manual target and landing runway persist after refresh.
- Return-to-AUTO is shared.
- Runway profile / modes / LAND SEP shared.
- Holding override shared.
- Missed / Dsequence / Remove / reserved-gap state shared.
- Realtime propagation to other controllers.
- Online controller presence.

## Part 15 — Disconnect / reconnect recovery

- Canonical flight identity is not tied only to one IVAO session ID.
- Disconnected airborne traffic can retain its slot as **GHOST** up to **30 minutes**.
- Reconnect restores target/runway/manual state where possible.
- Position plausibility checks elapsed time, position and groundspeed.
- Shared `RECONNECTED` / `POSITION JUMP` warnings.
- Landed/on-ground/low-speed-near-airport flights are released rather than incorrectly retained as Ghosts.

## Part 16 — Test / system tools

- TEST TRAFFIC mode.
- Collapsed System health summary / detailed drawer.
- Shows processing radius, ETA-FF refresh, route ETA coverage, delay splitting, AAR/demand, overload, separation health, Ghost/reconnect and shared-state health.
- Verification checklists:
  - `docs/AMAN_FOUR_CORE_VERIFICATION.md`
  - `docs/MAESTRO_V24_VERIFICATION.md`

---

# Timing model

```text
Live Radar / IVAO position + Flight Plan + AIRAC route
                         ↓
                       ETA-FF
                         ↓
                  + nominal STAR time
                         ↓
               natural landing estimate
                         ↓
       runway allocation + sequence constraints
                         ↓
                    STA / TLDT
                         ↓
             STA-FF / TTO at Feeder Fix
                         ↓
                 TDLY required
                         ↓
              EDLY + ADLY splitting
                         ↓
 speed / path / runway / holding operational guidance
```

When ATC sets a manual target, the target remains fixed while live ETA-FF continues to update, so required delay/advisories can move around that target.

---

# Still to do

## Source-confirmed functions needing exact workflow detail

- Change trajectory.
- Change Metering Fix.
- Change ETA-FF manual entry/override rules.
- Maximum Delay input semantics.
- MF constraint.
- Transfer Speed.
- FF Transfer constraints.
- Coordination workflow.
- Extra Flight data entry.

## Operational refinement

- Conformance / Target-at-risk monitoring.
- Data-confidence indication for ETA quality.
- Multi-controller simultaneous-edit conflict handling.
- Undo / audit history.
- What-if sequence planning.
- More complete demand/capacity planning windows.

## Validation

- Two-controller simultaneous testing.
- Real pilot disconnect / reconnect testing.
- Heavy traffic test with 20–40 arrivals.
- Midnight UTC service-date rollover.
- Further responsive HMI cleanup.
- Validate current local working values:
  - VTBS cross-runway stagger;
  - runway LAND SEP;
  - STAR nominal timings;
  - follower-based ATR / A380 special landing minima;
  - VTBD follower-runway cross-runway separation model;
  - final-position Frozen detector;
  - authoritative VTBD AAR.

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

Current priority remains **Approach-side arrival sequencing**. Centre-side supporting panels and full departure-management functions remain later phases.
