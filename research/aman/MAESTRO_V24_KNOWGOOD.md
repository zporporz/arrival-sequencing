# MAESTRO v2.4 Thai Knowgood

Authoritative project reference for the current AMAN rebuild:

- AEROTHAI / GREEN ATM Level 2 deck: `03.MAESTRO on Airspace Users v.2.4.pdf`
- Supporting AEROTHAI deck: `Arrival Sequencing Management-Maestro BACC v2.pdf`

This note records what the uploaded Thai material actually supports and separates it from project implementation decisions.

## Source-supported facts

### Processing coverage

The MAESTRO Concept of Operations slide describes radar processing coverage of roughly **200–300 NM** around the airport. The older AEROTHAI Flight Status slide independently places Unstable traffic approximately in the **300–200 NM** band from BKK VOR.

Project implementation:

- **300 NM** is used as the outer active-processing admission boundary.
- Destination traffic outside 300 NM can remain visible as monitored inbound but is not placed in the active landing sequence.
- The source does not define one hard universal 300.0 NM creation trigger, so the app labels this as the outer boundary of the documented 200–300 NM band.

### ETA-FF refresh

The Delay Splitting slide states that Dynamic Precision updates **ETA-FF from TopSky every 15 seconds**.

Project implementation:

- Browser live-traffic / ETA-FF refresh = **15 seconds**.
- The existing Whazzup backend cache is also 15 seconds.

### Core calculation terminology

The Concept of Operations sequence is:

1. Input from radar / flight plan / flight trajectory / stand data.
2. Calculate **ETA-FF** and TTG.
3. Build landing sequence with FCFS plus traffic constraints.
4. Derive **STA** and **STA-FF**.
5. Split required delay.

The existing project names TLDT/TTO are retained for compatibility in code, while the HMI introduces the MAESTRO terms as aliases:

- natural predicted feeder-fix time → **ETA-FF**
- target landing time → **STA / TLDT**
- target feeder-fix crossing time → **STA-FF / TTO**

### Delay Splitting

The source defines:

- **EDLY (En-route Delay)** — delay absorbed before the Feeder Fix.
- **ADLY (Approach Delay)** — delay absorbed after the Feeder Fix into the terminal/approach segment.

The Operational Quick-Reference Matrix shows:

| TDLY | EDLY | Primary | Secondary | Vector limit |
|---:|---:|---|---|---|
| 06 | 02 | Permit Entry | Reduce Speed | < 25 NM |
| 07 | 03 | Orbit / Permit | Assess inner traffic | ~ 30 NM |
| 08 | 04 | Consider Hold | Runway change | Max Limit |
| >=09 | >=05 | HOLD ALL | Issue EAT (STA-FF) | OVERLOAD |

Inference used by the project:

- Those rows imply an **ADLY budget of 4 minutes** (`TDLY = EDLY + ADLY`).
- Therefore positive delay is split as `ADLY = min(TDLY, 4)` and `EDLY = max(TDLY - 4, 0)`.
- This is a transparent inference from the matrix, not a claim that the source publishes a standalone “ADLY = 4” rule.

### Delay sign

The operating slides explicitly state:

- negative delay → expedite aircraft, shortcut and/or speed up;
- zero → normal flight;
- positive delay → speed reduction, path stretching, holding and potentially ground delay.

### Automatic runway allocation

The Operational Benefits slide states that MAESTRO processes available data to evaluate and automatically assign a suitable runway to each flight.

Project implementation:

- AUTO allocation picks the earliest feasible active arrival runway after current landing spacing, pairwise spacing and VTBS cross-runway constraints.
- If equivalent, the less-loaded runway is preferred.
- Manual runway assignment remains available to the controller.

### Confirmed operational menu items

The MAESTRO screenshot/menu in the v2.4 deck visibly contains:

- Recompute
- Refresh Delay
- Change runway
- Change trajectory
- Change Metering Fix
- Change ETA-FF
- Maximum Delay
- MF constraint
- Transfer Speed
- FF Transfer constraints
- Coordination
- Missed Approach
- Insert arrival flight
- Insert closure
- Insert gap
- Extra Flight
- Dsequence
- Remove

Project implementation currently provides a safe baseline for the items whose operational intent is sufficiently clear from the source and current app:

- Change runway — existing runway selector.
- Insert closure — runway `CLOSED` mode.
- Missed Approach — removes the flight from active sequence and leaves it available for explicit reinsert.
- Dsequence — removes the flight from active sequence and leaves it available for explicit reinsert.
- Insert gap — reserve +1 or +2 minutes after a selected flight; shared and cascaded.
- Remove — removes from active sequence with explicit reinsert available while the live flight remains connected.

The remaining menu items are confirmed to exist, but their exact field semantics / controller workflow are not sufficiently documented in the uploaded source and are not guessed.

### Capacity

The Airport Capacity Heatmap slide for VTBS shows **ARR 37 MAX**.

Project implementation:

- VTBS displayed arrival capacity is capped at **37 arrivals/hour**.
- VTBD has no equivalent maximum in this deck, so its current HMI capacity remains a calculated estimate from configured runway spacing and is not labelled as an authoritative Thai AAR.

### Shared environment

The Coordination & Workload Management slide states that BACC and BAPP use the same shared MAESTRO data feed and that the timeline is continuously monitored/updated in real time.

Project implementation:

- Supabase shared AMAN state remains the common controller state for targets, runway configuration, holding and operational actions.

## Still source-uncertain

Do not silently invent the following until another Thai reference is available:

- exact meaning/input UI for `Maximum Delay`;
- exact `Change trajectory` geometry workflow;
- exact `Change Metering Fix` restrictions;
- exact `Transfer Speed` and `FF Transfer constraints` behavior;
- exact `Coordination` state machine;
- exact `Extra Flight` data-entry fields;
- whether the processing boundary is always exactly 300 NM for every airport/configuration;
- authoritative VTBD AAR/capacity maximum;
- authoritative pairwise ATR/A380 separation table beyond the current project working values.
