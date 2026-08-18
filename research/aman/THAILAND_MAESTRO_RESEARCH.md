# Thailand AMAN / MAESTRO Operational Research

**Research baseline:** 2026-08-18  
**Scope:** Arrival Manager (AMAN) / MAESTRO as used around Bangkok ACC, with priority on VTBS and VTBD.  
**Goal:** provide an evidence-based operational model for a clean web implementation without carrying over assumptions from the previous frontend.

---

## 1. What AMAN is

**TH-OFFICIAL / GENERIC-AMAN**

AEROTHAI publicly describes **Arrival Manager (AMAN)** as technology for managing inbound flights, paired with Intelligent Departure (iDEP) for outbound traffic. EUROCONTROL describes an AMAN as a ground-based planning tool that automatically establishes an arrival sequence and schedule and permits controller intervention.

For this project the useful mental model is:

1. collect predicted arrival/trajectory information;
2. determine where each inbound flight is expected to reach the feeder/entry point and runway;
3. establish a landing sequence that respects the configured runway/capacity constraints;
4. produce target times for the sequence;
5. tell the controller how much time should be gained or lost before the feeder fix;
6. keep recalculating while the flight is still sufficiently far away;
7. progressively stabilise/freeze the plan as the flight approaches the terminal area/final.

The AMAN is **decision support**. It does not replace ATC separation responsibility. A controller still implements the plan through normal tactical ATC techniques and may need to resolve deviations/conflicts manually.

---

## 2. Thailand deployment confirmed by AEROTHAI material

### VTBS / VTBD

**TH-DECK**

The AEROTHAI presentation `Arrival Sequencing Management-Maestro BACC v2.pdf`, prepared for the Airspace Users–ANSP Meeting on 20 August 2025, states:

- **VTBS / VTBD — IN OPERATION (May 2025)**
- AMAN-to-AMAN coordination
- 3-runway operation capability for VTBS
- Time to Lose / Time to Gain at feeder fixes
- Speed Advisory
- if necessary, Time to Leave Holding Fixes

This is the strongest Thailand-specific operational source currently held by the project.

### VTSP

**TH-DECK, historical plan only**

The same August 2025 presentation showed a VTSP rollout plan:

- Dataset preparation: Jun–Jul 2025
- Dataset test/fine-tune: Aug–Oct 2025
- Procedural setup: Nov 2025
- Operational trial: Jan–Mar 2026
- expected readiness: Apr 2026

As of this research date, a current AEROTHAI public source confirming that **VTSP AMAN is operational** has not been found. AEROTHAI does confirm that iDEP became operational at Chiang Mai and Phuket on 19 February 2026, but that is not proof of AMAN deployment. Therefore VTSP AMAN status remains **UNKNOWN / NEEDS CURRENT CONFIRMATION**.

### VTCC / VTSS / VTSM

**TH-DECK, historical plan only**

The August 2025 deck listed VTCC / VTSS / VTSM as future deployment expected in 2027. Treat this only as a planning statement from 2025, not a current operational fact.

---

## 3. Where MAESTRO is used at BACC

**TH-DECK / OBSERVED**

The AEROTHAI deck provides photographs/screenshots of two deployment contexts:

### 3.1 Centre AMAN Position

A dedicated workstation labelled **“AMAN Arrival Manager”** is shown with:

- one surveillance/radar-style display;
- one dedicated tall MAESTRO sequence display;
- a vertically oriented time-based arrival sequence.

This strongly indicates that arrival sequencing is a dedicated planning function at BACC, not merely a small table embedded in APP radar.

### 3.2 MAESTRO at Controller Working Position (BACC)

A second image shows MAESTRO integrated into a controller working position alongside several traffic-list windows. The MAESTRO timeline is only one part of the operational picture; additional windows show inbound, ETA/ETO and departure information.

**Design implication:** a useful web replica should think in terms of a **primary AMAN timeline plus supporting traffic panels**, rather than making the entire product a spreadsheet.

---

## 4. Core Thailand AMAN outputs confirmed by the AEROTHAI deck

**TH-DECK**

The following functions are explicitly listed:

### 4.1 Time to Lose / Time to Gain at Feeder Fixes

The system provides time-based metering guidance at feeder fixes. This is the key tactical output for upstream controllers: the aircraft is compared against its target time at the feeder/IAWP and the system indicates whether time must be absorbed or recovered.

### 4.2 Speed Advisory

The system can recommend speed-based action to help achieve the target sequence.

### 4.3 Time to Leave Holding Fixes

When holding becomes necessary, MAESTRO can provide a target time to leave the holding fix. This is important because large delay cannot always be absorbed by speed control/path extension alone.

### 4.4 AMAN-to-AMAN Coordination

AEROTHAI explicitly lists AMAN-to-AMAN coordination. The exact protocol/data fields used in Thailand are not present in the available public deck and therefore remain implementation-unknown.

### 4.5 VTBS 3-runway capability

AEROTHAI explicitly lists 3-runway operation capability for VTBS. Exact runway allocation optimisation rules, mixed-mode rules, and runway dependency constraints are not contained in the available source.

---

## 5. Flight status lifecycle used by Thailand MAESTRO

**TH-DECK — page 6**

AEROTHAI provides an exact four-stage status model:

| Status | Time criterion | Approx. distance from BKK VOR* |
|---|---|---|
| **Unstable** | 1 minute after flight creation from **ABI** | 300–200 NM |
| **Stable** | 15 minutes before IAWP (Feeder Fix) | 200–90 NM |
| **Superstable** | 5 minutes before IAWP (Feeder Fix) | 90 NM–10 NM final |
| **Frozen** | 4 minutes before landing | 10 NM final |

\*The slide says the approximate-distance conversion is based on aircraft speed 480 kt.

Important cautions:

- The deck names **ABI** as the source/event from which a flight is created, but the exact message definition/interface used by the installed MAESTRO is not described in the deck.
- “Frozen” definitely identifies the final planning state. The available source does **not** explicitly say which fields become impossible to edit, so the web implementation must not invent an edit-lock policy solely from the word Frozen.

---

## 6. Real MAESTRO arrival-row structure supplied by Thailand SME/screenshots

**TH-SME + OBSERVED**

The project owner supplied a real VTBS MAESTRO screenshot and an operational explanation from a Thailand SME. The row is read left-to-right as:

1. **TLDT** — Target Landing Time
2. **Callsign**
3. **Type** — aircraft type
4. **STAR / IAWP code**
5. **TTO** — Target Time Over the STAR entry / feeder fix
6. **Time Delay Required**
7. **Runway**

Example visual row pattern:

`27  THA631  A320  E  08  1  19`

Operational interpretation supplied to the project:

- TLDT ≈ `..:27`
- THA631 = callsign
- A320 = aircraft type
- E = EASTE feeder/IAWP family
- TTO ≈ `..:08`
- delay required = 1 minute
- landing runway = 19

This row order is a stronger design reference for our new screen than the previous ETO→ELDT→TLDT→CTO spreadsheet UI.

---

## 7. Time Delay Required — Thailand SME explanation

**TH-SME**

The SME explanation is important and should be preserved exactly at concept level:

> The displayed delay is the amount of time that must be added/absorbed. The system is not merely saying when the aircraft will arrive; it shows the time the controller needs to make the aircraft lose so that it meets the target.

Therefore the useful conceptual relationship is:

`Delay Required = Target Time Over (TTO) - predicted/estimated time over the IAWP`

Example:

- predicted IAWP crossing = 10:58
- TTO = 11:08
- required delay = +10 min

The controller then needs to absorb roughly ten minutes before the target point using an appropriate technique.

If the aircraft is predicted later than the target, the corresponding action is time gain / expedite.

**Do not confuse this number with ELDT/TLDT itself.**

---

## 8. Delay colour coding observed on real Thailand MAESTRO material

**OBSERVED / TH-SME screenshot**

A supplied MAESTRO slide/screenshot gives the action categories:

- **Green — Expedite**
- **Grey/white — Nothing**
- **Yellow — Speed reduction**
- **Orange — Path Stretching**
- **Red — Holding**

### Unknown: numeric thresholds

No authoritative Thailand source currently held by the project specifies the exact delay thresholds that change the colour/action from speed reduction → path stretching → holding, nor the negative/gain threshold for Expedite.

**Implementation rule:** do not hard-code invented thresholds. Store the categories now; make thresholds configurable only after Thailand confirmation.

---

## 9. Feeder Fix / IAWP model for Bangkok metroplex

Thailand AIP uses **IAWP** in flight-planning procedures for aircraft arriving VTBD/VTBS. The AEROTHAI MAESTRO deck calls the metering point a **Feeder Fix**. For the web project, these concepts should be treated as the arrival metering/entry point used for TTO unless a procedure-specific source says otherwise.

### 9.1 VTBD IAWPs

**TH-OFFICIAL — CAAT ENR 1.10**

The current project mapping used for Don Mueang is:

- **WEHHA** — west/northwest family including L524, G463/P646, L507
- **NAKON** — north family including A464, W9/Y7/Y28, B346/W21, R474
- **ENDUU** — east/northeast family including W1/Y1/Y2/Y20
- **SEHNA** — southeast/east family including G474, M633, R468, P629, N891, R334, M644, W33, Y12
- **SABAI** — south/southwest family including G458/W31, M769, Y99, A464/W19, and VTBU R201 arrangements

Important example already relevant to the project:

`... GOKEX Y96 EMTIX Y99 HOTEL DCT SABAI`

Therefore a flight plan ending visually near HOTEL can still imply **SABAI** as the planned IAWP for VTBD.

### 9.2 VTBS IAWPs

**TH-OFFICIAL — CAAT ENR 1.10 / VTBS AD 2**

The principal IAWPs are:

- **EASTE** — east/northeast family (e.g. W1/Y1/Y2, Y13)
- **TUMGA** — southeast/east family (e.g. G474, M633, R468, P629, N891, R334, M644, W33, Y12, and some R201 flows)
- **LEBIM** — south/southwest family (e.g. G458/W31/Y99 via HOTEL, M769/Y98, A464/W19)
- **WILLA** — west/northwest family (e.g. M502, L301, L524, G463/P646, L507)
- **NORTA** — north family (e.g. A464, W9/Y7/Y28, B346/W21/W39, R474)

### 9.3 VTBS one-letter codes confirmed by SME

**TH-SME**

- `E` = EASTE
- `T` = TUMGA
- `L` = LEBIM
- `N` = NORTA
- `W` = WILLA

These compact letters match the visual style of the real MAESTRO timeline and are useful for a dense HMI.

---

## 10. STAR relationships currently published by CAAT

### VTBD

**TH-OFFICIAL**

For RWY 21L/21R, published RNAV STARs include:

- ENDUU3A
- NAKON3A
- SABAI3A
- SEHNA3A
- WEHHA3A

For RWY 03L/03R the corresponding family uses the `1B` designators.

### VTBS

**TH-OFFICIAL**

Published STAR families use the five IAWPs:

- EASTE
- LEBIM
- NORTA
- TUMGA
- WILLA

For RWY 19/20L/20R, the current published family is `1C`; for RWY 01/02L/02R it is `1D` in the latest CAAT material indexed during this research.

**Design implication:** the web should store **IAWP and procedure designator as separate fields**. A dense MAESTRO row may show only a one-letter feeder code, but detail/hover/selection can expose the full STAR.

---

## 11. Target times versus ATFM calculated times

This distinction is critical because the previous prototype mixed these concepts.

### 11.1 AMAN-side target concept

**TH-SME / OBSERVED + GENERIC SESAR confirmation of TLDT terminology**

The real MAESTRO row supplied to the project uses:

- **TLDT — Target Landing Time**
- **TTO — Target Time Over** the feeder/STAR entry point

These are operational targets used to implement the arrival sequence.

### 11.2 Bangkok ATFMU terminology

**Bangkok ATFMU Users Manual Rev.3**

The ATFM manual separately defines:

- ETO — Estimated Time Over
- CTO — Calculated Time Over, issued by an ATFM unit following tactical slot allocation
- ELDT — Estimated Landing Time
- CLDT — Calculated Landing Time, issued by an ATFM unit following tactical slot allocation
- ALDT — Actual Landing Time

Therefore **CLDT/CTO are not automatically synonyms for MAESTRO TLDT/TTO**. They may be numerically related in some integrated flow-management context, but the new frontend should keep the semantic namespaces separate until a Thailand source explicitly maps them.

---

## 12. Generic AMAN sequencing behaviour that is safe to use as architecture guidance

**GENERIC-AMAN — EUROCONTROL / SESAR, not Thailand configuration proof**

Primary European AMAN references support the following general behaviours:

- automatic calculation of an optimised arrival sequence;
- output of scheduled/target arrival times and landing runways;
- configurable planning horizon;
- recomputation when a new arrival appears or predicted arrival data changes;
- controller ability to amend scheduled arrival time and runway;
- configurable maximum landing flow rate;
- ability to reserve landing slots;
- automatic support for holding when delay cannot be absorbed through speed control;
- “what-if” sequence generation before committing a plan;
- extended AMAN can send upstream controllers time/speed advisories early enough to absorb delay before low-level holding.

These capabilities provide a good architecture vocabulary, but each one must be marked optional/configurable in our product until verified against Thailand MAESTRO.

---

## 13. Likely operational loop for the clean implementation

This section combines Thailand-verified outputs with generic AMAN architecture. It is a **design model**, not a claim that the installed MAESTRO uses the exact same algorithm internally.

### A. Flight acquisition

- ingest arriving flight/track/FPL data;
- determine destination airport and applicable arrival flow;
- determine IAWP/feeder fix from filed route/STAR and CAAT arrival planning rules;
- create/activate the AMAN flight when it enters the applicable horizon/status rule.

### B. Prediction

- calculate predicted/estimated time at IAWP;
- calculate predicted landing time using trajectory/procedure/runway assumptions;
- update predictions as track/trajectory changes.

### C. Sequence construction

- sort/optimise arrivals against runway configuration and capacity;
- apply required spacing/separation constraints;
- allocate landing runway where multi-runway logic permits;
- establish TLDT for each flight.

### D. Feeder target derivation

- derive TTO at the assigned IAWP from TLDT and the planned IAWP→runway trajectory/time model.

### E. Tactical advisory

- compare predicted time at IAWP against TTO;
- display Time to Lose / Gain;
- suggest action class: Expedite / Nothing / Speed reduction / Path stretching / Holding;
- if holding is needed, compute/display a target leave-holding time where applicable.

### F. Stabilisation

- progressively reduce sequence volatility according to Unstable → Stable → Superstable → Frozen status.

### G. Monitoring

- continue comparing actual progress with target;
- show deviations to the controller;
- recompute or require manual intervention when the target becomes infeasible.

---

## 14. Runway/capacity inputs that an AMAN needs

**TH-DECK + OBSERVED + GENERIC-AMAN**

The real MAESTRO screen visibly contains runway-mode/configuration boxes and numeric spacing/rate-related values. Generic AMAN sources also confirm that maximum landing flow rate and runway allocation are core sequencing inputs.

For our rebuild, model these settings independently rather than embedding them in UI code:

- airport
- runway configuration / mode
- arrival runway(s)
- departure runway(s) where runway use is dependent
- runway arrival rate / flow-rate constraint
- minimum planned interval / spacing parameter
- wake/separation matrix or equivalent sequence-dependent interval rules
- runway occupancy / operational modifiers
- temporary runway slot reservations/blockages
- holding fixes available to the arrival flow
- IAWP→runway nominal/trajectory timing model
- planning horizon
- status transition rules

Only some of these are currently Thailand-verified. See `HMI_SETTINGS_CATALOG.md` for confidence per field.

---

## 15. Separation is not a single fixed number

**ICAO Doc 4444 in project library**

The interval between successive approaches depends on factors including relative speeds, distance from the specified point to the runway, wake turbulence separation, runway occupancy, meteorological conditions, and other conditions affecting runway occupancy. When ATS surveillance is used, local instructions specify the actual minimum distances and circumstances requiring larger spacing.

**Design implication:** the clean system should not reduce arrival sequencing to one universal `X minutes` value. The old fixed nominal-time model can be retained as a fallback/configured timing dataset, but the new domain model should allow sequence-dependent spacing rules later.

---

## 16. What data our existing backend can already provide

This is implementation context, not MAESTRO evidence.

The preserved backend currently gives us useful building blocks for a new AMAN UI:

- IVAO SSO/profile/session;
- live inbound traffic from IVAO Tracker;
- FPL route, aircraft, departure/destination and live track information;
- server-side route geometry through the existing AIRAC parser integration;
- current/derived ETO capability to a reference fix;
- domestic Thailand takeoff-track + filed EET context;
- CAAT-derived route→IAWP and STAR mappings already implemented previously;
- Supabase realtime arrivals/session/config data.

The new frontend should consume these as input services but should not inherit the old presentation or old semantics automatically.

---

## 17. Thailand-specific items still missing and worth obtaining

These are the highest-value questions for the next SME/source pass:

1. Exact numeric thresholds for Delay Colour Coding.
2. Exact definition of `TTO` in installed MAESTRO: feeder-fix crossing target, STAR entry target, or another reference in special cases.
3. Exact relationship between TLDT and TTO for each IAWP/runway — fixed nominal, trajectory-based, aircraft-specific, or mixed.
4. Exact runway spacing configuration logic and wake-dependent rules.
5. Meaning and editability of the top MAESTRO configuration boxes (`ΔT`, `Earliest`, `TMA`, `TOT`, `HLD`, etc.).
6. Exact semantics of the CWP inbound-list fields `NFL`, `ETN`, `CFL`, `RFL`, `LFUNC`.
7. Whether Frozen forbids manual resequencing or only indicates planning stability.
8. Manual interaction model: drag aircraft, change target time, swap sequence, runway reassignment, lock/freeze, exclusion, slot reservation.
9. How MAESTRO treats missed approaches/go-arounds.
10. How exemptions, emergency flights, priority flights and runway closures affect sequence construction.
11. How AMAN-to-AMAN coordination is represented and which target/estimate messages are exchanged.
12. Current operational status/configuration of VTSP AMAN in 2026.
13. Current plans/status for VTCC/VTSS/VTSM beyond the 2025 deck.
14. Exact planning horizon and flight-creation ABI conditions used at BACC.
15. Whether controller-specific views filter by north/south/sector/APP position and what the `1N / 2N / 3N` tabs mean.

Until confirmed, these should remain explicitly tagged `UNKNOWN`, not silently guessed.

---

## 18. Product direction supported by the research

The new frontend should be designed from the operational picture outward:

- one airport/workspace at a time;
- a real time-oriented AMAN sequence as the primary view;
- compact feeder-fix codes and target times;
- supporting inbound/departure windows;
- visible flight stability state;
- visible delay-required/advisory class;
- runway/configuration controls separated from the sequence itself;
- detailed flight data available on demand rather than filling the primary timeline with every field;
- all uncertain MAESTRO settings represented in configuration only after they are verified.

Do **not** rebuild the previous spreadsheet and merely rename its columns. The source material shows that the actual operational object is a **time-based arrival plan with target/advisory information**.
