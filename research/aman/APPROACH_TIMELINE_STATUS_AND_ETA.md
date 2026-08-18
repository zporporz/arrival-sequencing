# Approach AMAN — Timeline, Status and IVAO ETA Model

**Baseline:** 2026-08-18  
**Scope:** Approach-only clean rebuild.  
**Evidence:** TH-SME + supplied Thailand MAESTRO screenshots + AEROTHAI Flight Status slide.

---

## 1. Timeline behaviour

The Approach MAESTRO display is a **vertical time timeline**, not a conventional fixed table.

Confirmed/observed behaviour:

- A thin red horizontal line represents **actual/current UTC time**.
- The red current-time line remains **fixed in the viewport**.
- As real time advances, the **time ruler, time labels and aircraft labels move downward past the fixed red line**.
- The supplied Thailand display uses a major labelled interval of **5 minutes** with minor ticks at **1-minute** spacing.
- Aircraft are positioned against the timeline by their target landing time / sequence position.

This moving-content / fixed-now-line behaviour is a core UI requirement for the rebuild.

### Passed-current-time aircraft

For the project display, once an aircraft's landing/target position passes the fixed red current-time line, treat it as **assumed landed for display purposes**.

Do not remove it immediately. Keep passed aircraft visible below the current-time line for a user-selectable history window:

- 5 minutes
- 10 minutes
- 15 minutes
- 20 minutes

Default working value: **10 minutes**.

After the selected post-line retention period expires, the aircraft can disappear from the active timeline/history view.

---

## 2. Flight status lifecycle

AEROTHAI publishes the Thailand MAESTRO lifecycle:

- **Unstable** — 1 minute after flight creation from ABI; approximate 300–200 NM from BKK VOR at the slide's 480 kt reference.
- **Stable** — 15 minutes before IAWP / Feeder Fix; approximate 200–90 NM.
- **Superstable** — 5 minutes before IAWP; approximate 90 NM to 10 NM final.
- **Frozen** — 4 minutes before landing; approximate 10 NM final.

For this rebuild these are primarily **ATC awareness/status colours**, not hard edit-lock states unless a later operational rule requires that.

### Operational working description from SME

For newly received traffic:

1. Traffic enters the system automatically as **Unstable**.
2. The system automatically creates an initial timing estimate and places the callsign on the timeline.
3. If the resulting TLDT conflicts with another aircraft, the controller can move/drag the callsign to a suitable target time.
4. After target placement, the system recalculates:
   - required delay;
   - delay colour/action class;
   - downstream target timing.
5. In the observed working method the callsign then presents as the **Stable/orange** state after the controller has established the target sequence.
6. Superstable and Frozen then follow the published proximity/time stages.

Important: the exact relationship between a manual drag and the published `15 min before IAWP` Stable trigger may need one final clarification. Do not make the frontend dependent on an edit-lock interpretation of Stable/Frozen.

---

## 3. How real MAESTRO gets an initial IAWP estimate

Operational explanation supplied to the project:

The real system can use filed-flight-plan timing approximately as:

`estimated landing/arrival time ≈ EOBT + EET`

and therefore:

`estimated IAWP time ≈ EOBT + EET - nominal STAR/IAWP-to-runway time`

The nominal STAR times are stored separately in the project constants/research.

This provides a useful initial estimate before tactical track data becomes more useful.

---

## 4. IVAO problem: pilots often do not depart at filed EOBT

On IVAO, a pilot may connect/file a flight plan substantially before or after the filed Departure Time/EOBT. Therefore using only:

`EOBT + EET - STAR time`

can place the aircraft at the wrong IAWP/TLDT timing.

This is a project data-quality issue, not an AMAN conceptual issue.

---

## 5. Recommended IVAO timing strategy

Use a **progressive-confidence estimate** rather than trusting one source for the whole flight.

### Stage A — connected / on ground / before actual takeoff is known

Use the flight-plan estimate only as a **provisional Unstable timing**:

`provisional IAWP ETA = filed departure time + filed EET - nominal STAR time`

Mark the estimate internally as low-confidence/provisional.

This lets the aircraft appear in the AMAN planning horizon immediately after connection/FPL availability without pretending the filed departure time is actual.

### Stage B — actual takeoff detected

When the IVAO track changes from on-ground to airborne, record the observed takeoff time.

Then rebase the estimate:

`re-based IAWP ETA = observed takeoff time + filed EET - nominal STAR time`

This removes the largest error caused by a pilot departing late/early relative to EOBT.

### Stage C — airborne and route/track position is usable

Once airborne, prefer a **live route-position ETA** over the filed-time estimate:

- current aircraft position;
- filed/parsed route geometry;
- current or smoothed groundspeed;
- remaining path to the selected IAWP/feeder fix.

This is the preferred operational estimate for the clean rebuild because it updates as the aircraft actually flies.

### Stage D — aircraft first appears already airborne

If no ground-to-air transition was observed (for example the user opens the page after the flight is already airborne), do not require an observed takeoff time. Use live route-position ETA immediately.

### Fallback order

Suggested ETA-source priority:

1. **live route-position ETA to IAWP**;
2. observed takeoff + filed EET - nominal STAR time;
3. filed EOBT + filed EET - nominal STAR time;
4. clearly marked manual/provisional fallback if route/FPL data is incomplete.

The displayed controller workflow should remain simple; source-confidence/debug details belong in a detail panel rather than the main timeline.

---

## 6. Delay recalculation after controller sequencing

When ATC drags/repositions a callsign to a new target landing slot:

- new `TLDT` = selected target slot on the landing timeline;
- derive the new `TTO` using the applicable STAR/IAWP nominal time;
- compare TTO with the current predicted IAWP ETA;
- calculate `Delay Required`;
- classify delay using the current working colour thresholds;
- move the label to the selected target location and update the displayed status/colour.

Conceptually:

`Delay Required = TTO - predicted IAWP ETA`

Positive values mean time must be lost; negative values mean time must be gained/Expedite.

---

## 7. Holding presentation

When delay reaches the current Holding action band:

- display the Holding action in red;
- holding is associated with the STAR head / feeder-entry holding point;
- the displayed expected leave-hold time moves later by the amount that still needs to be absorbed.

Example: if a flight needs another 5 minutes in hold, its expected leave-hold target is shifted 5 minutes later.

The controller still watches the actual aircraft/radar behaviour; AMAN is providing target-time sequencing information.

---

## 8. Implementation principle

Do not mix the following concepts:

- **Predicted time** — where the aircraft is currently expected to arrive based on available data;
- **Target time** — where ATC/AMAN wants the aircraft to be in the sequence;
- **Delay Required** — difference between predicted and target timing;
- **Status** — planning stability/awareness state (Unstable/Stable/Superstable/Frozen);
- **Current-time line** — fixed visual reference representing actual UTC now.

Keeping these separate is essential for a MAESTRO-like interface.
