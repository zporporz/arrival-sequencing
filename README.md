# Bangkok FIR Arrival Sequencing

AMAN / MAESTRO-style arrival sequencing prototype for IVAO Thailand.

**Production:** https://atc-sequence.pages.dev  
**Repository:** https://github.com/zporporz/arrival-sequencing  
**Current operational scope:** VTBD / VTBS approach arrival sequencing

> Prototype / training decision-support only. It does not replace ATC procedures, separation minima, local instructions, or controller judgement.

---

## Current status — 21 Aug 2026

The live and TEST TRAFFIC paths now share the same sequencing, manual-target, separation, lifecycle, TLDT-freeze and landed-history logic. TEST TRAFFIC supplies deterministic synthetic inputs and never writes its fake callsigns into production shared flight state.

Primary project reference for the broader MAESTRO alignment remains:

`research/aman/MAESTRO_V24_KNOWGOOD.md`

---

# Operational timing model

```text
IVAO position / GS / altitude / vertical trend
                +
filed route + AIRAC route geometry
                +
aircraft descent-performance profile
                ↓
              ETA-FF
                ↓
      + nominal FF → landing time
                ↓
       natural landing estimate
                ↓
runway assignment + pairwise separation
                ↓
             STA / TLDT
                ↓
   target FF time (STA-FF / TTO)
                ↓
TDLY = target FF time − live ETA-FF
                ↓
        EDLY / ADLY guidance
```

## Time fields

- **ETA-FF** — estimated time at the Feeder Fix / IAWP from the current live prediction.
- **STA-FF / TTO** — target time over the Feeder Fix implied by the assigned landing target.
- **STA / TLDT** — target landing time used by the arrival sequence.
- **ALDT proxy** — first observed IVAO terminal-state timestamp near the airport. This is not claimed to be exact threshold-crossing time.

The main timeline row displays:

```text
TLDT | ACID | TYPE | IAWP | ETA-FF | DELAY | RWY
```

`STA-FF / TTO` remains available internally and in row metadata because delay is calculated against it.

---

# ETA-FF prediction

Live ETA-FF uses, where available:

- IVAO live latitude / longitude.
- Current GS plus recent GS trend.
- Altitude and vertical trend during descent.
- Filed flight-plan route.
- AIRAC route geometry and cumulative distance to the resolved Feeder Fix.
- SimBrief aircraft descent-performance profile.

The route path is followed segment-by-segment when geometry is available; it is not intentionally reduced to straight-line position-to-fix distance.

Fallback order when live route prediction cannot be produced:

1. Actual departure + filed EET.
2. Tracked takeoff + filed EET.
3. Filed EOBT + filed EET.

Browser ETA-FF refresh and the whazzup backend cache are both **15 seconds**.

Prediction accuracy is not yet expressed as a verified ±seconds or ±minutes figure. That requires storing actual Feeder Fix crossing observations and back-testing the prediction at multiple look-ahead distances.

---

# AMAN lifecycle

One lifecycle runtime is used for both live and TEST TRAFFIC rows.

## UNSTABLE

- Outer planning phase, approximately the 300–200 NM region.
- The displayed ETA-FF follows the continuously recalculated prediction.
- AUTO sequencing and TLDT may move when prediction or traffic order changes.

## STABLE

- Approximately 15 minutes before the Feeder Fix, with the source-backed distance band used only as supporting context.
- If ATC has not intervened, ETA-FF may continue to update from the live calculation.
- The first ATC drag creates a controlled target and stops the displayed time from following later automatic recalculation.
- ATC may drag the controlled target repeatedly; every intentional move replaces the previous target.
- Live ETA-FF still runs behind the target, so delay and advisories can increase or decrease.

## SUPERSTABLE

- Approximately 5 minutes before the Feeder Fix.
- The current TLDT / target is protected from later automatic ETA refresh and cascade movement.
- Live ETA-FF continues in the background, so delay remains dynamic.
- ATC may still drag the target.
- If the new target no longer meets the SUPERSTABLE condition, the flight returns to STABLE while retaining ATC target ownership.

## FROZEN

FROZEN is entered when either condition is met:

- `TLDT − current time <= 4 minutes`; or
- live traffic is detected on approximately 10 NM final with compatible runway geometry / heading.

After entry:

- FROZEN is sticky until the active row leaves the sequence.
- TLDT is fixed at the value captured at the gate.
- Automatic ETA refresh and cascade cannot move that TLDT.
- Drag, double-click target reset and runway editing are blocked for that row.

TEST TRAFFIC has no real radar position, so it uses the same **TLDT minus four minutes** gate but deliberately does not fabricate the 10 NM positional sensor.

## LANDED / ALDT proxy

The live landing-history endpoint treats the first near-airport IVAO terminal observation as the landing-time proxy. Recognized terminal indications include:

- `landed`
- `on ground`
- `on blocks`
- `taxi` / `taxiing`
- `parking`
- `onGround = true`

The first timestamp is inserted once. Later taxi or parking samples use conflict-ignore behavior and cannot move `landed_at` forward.

The landed row then moves upward relative to the fixed current-time line while its displayed ALDT remains unchanged.

---

# TEST TRAFFIC parity

TEST TRAFFIC is intended to exercise operational behavior, not only draw sample labels.

It uses the same code paths as live traffic for:

- runway assignment;
- automatic sequence construction;
- manual drag and repeated target changes;
- same-runway and cross-runway cascade;
- centralized final-approach / landing-separation resolution;
- delay calculation and EDLY / ADLY split;
- UNSTABLE → STABLE → SUPERSTABLE → FROZEN lifecycle;
- SUPERSTABLE target protection;
- TLDT four-minute FROZEN gate;
- FROZEN edit blocking;
- landed-history row construction and fixed first-observed ALDT behavior.

Synthetic aircraft categories are assigned deterministically only to `demo:` predictions before pairwise separation is resolved. They neither wait for an asynchronous SimBrief request nor populate the live aircraft-performance cache.

For the final landed step, TEST TRAFFIC creates one synthetic terminal observation when the test row reaches TLDT. This drives the same fixed landed-history display without calling or modifying production landing data.

TEST TRAFFIC flight-specific AMAN state requests are intercepted locally. Fake callsigns therefore do not create, clear, or overwrite production `aman_flight_states` rows.

### Deliberate TEST limitations

- It does not reproduce IVAO route, GS, wind, altitude or vertical-profile uncertainty.
- Its ETA input is deterministic synthetic data; it does not validate ETA-FF accuracy.
- It has no real 10 NM final sensor.
- Its terminal observation is synthesized at TLDT rather than received from IVAO.
- Shared multi-controller persistence of synthetic flight targets is intentionally disabled.

---

# Arrival sequencing

## Automatic sequence

- Traffic enters active sequence processing at the configured outer boundary, currently 300 NM.
- Destination traffic outside the boundary remains visible as monitored traffic.
- AUTO sequencing starts from natural landing estimates and enforces runway and pairwise constraints.
- Late insert protection prevents a newly entering flight from silently disrupting an established plan.

## Manual sequence

- Drag sets a manual / controlled landing target.
- Repeated drag remains available in STABLE and SUPERSTABLE.
- Double-click returns a non-FROZEN flight to AUTO.
- Manual runway assignment uses the same cascade and conflict logic as AUTO.
- Separation conflicts are checked after same-runway and cross-runway processing.

## Current timeline behavior

- Fixed red current-time / ACTUAL line.
- 1-minute minor ticks and 5-minute major ticks.
- Scrollable timeline history and future horizon.
- Configurable post-current-line history retention.
- VTBD and VTBS can be displayed on opposite sides of one timeline.

The ACTUAL line is the current UTC reference. A planned row crossing that line is not itself proof of landing; the landed-history row is created only from the live or synthetic terminal observation described above.

---

# Separation model

All AUTO, manual, cascade, conflict and cross-runway paths use the same centralized pairwise resolver.

Operational wording follows:

```text
X following Y = X is the follower, Y is the leader
```

## Final Approach Spacing overrides

When a pair matches one of these rules, the listed rule replaces normal LAND SEP for that pair:

- PER B following PER B = **2 minutes**.
- Any non-B category following PER B = **4 minutes**.
- Any follower behind A380 / A388 = **7 NM**.
- PER B following PER A = **7 NM**.
- PER C or D following PER A = **12 NM**.
- Any unmatched pair falls back to existing LAND SEP.

NM rules are converted to timeline seconds using the project final-reference speed of 140 kt.

## Existing follower landing minima

These remain part of the LAND SEP fallback layer and are separate from the Final Approach Spacing overrides:

- Follower A380 / A388 / wake J: at least **3 minutes**.
- Follower ATR / AT7x: at least **4 minutes**.
- Otherwise use the configured runway / cross-runway base rule.

## Multi-runway behavior

### VTBD

- 21R and 21L form one airport-wide arrival sequence.
- Cross-runway base separation uses the follower runway's configured LAND SEP before any matching final-approach override.

### VTBS

- Same-runway traffic uses configured runway LAND SEP.
- Different-runway traffic uses the current project working stagger of 1 minute before any matching larger rule.

Current runway spacing defaults remain configurable in the HMI.

---

# Delay and operational guidance

- `TDLY = target FF time − live ETA-FF`.
- Positive TDLY means time must be lost.
- Negative TDLY is displayed as gain / expedite requirement.
- The working approach-delay budget is 4 minutes.
- Delay is split into:
  - **EDLY** — delay absorbed before the Feeder Fix.
  - **ADLY** — delay absorbed after the Feeder Fix.

The HMI provides project-level speed, path-stretching, holding, runway-change and overload guidance. These are decision-support estimates and are not claims of the proprietary MAESTRO internal algorithm.

---

# Shared state and recovery

- Supabase shared runway configuration and spacing.
- Shared live-flight manual target and runway.
- Shared return-to-AUTO.
- Shared HOLD / NO HOLD and operational actions.
- Missed approach, desequence, remove, reinsert and reserved-gap workflow.
- Controller presence and realtime propagation.
- Disconnect / reconnect ghost recovery with position plausibility checks.

Synthetic TEST TRAFFIC flight rows are intentionally isolated from production flight-state writes.

---

# Navdata administration

The staff navdata importer accepts Navigraph / Little Navmap SQLite input in the browser and stages structured STAR data to the backend.

Current scope:

- all Thailand airports matching `VT**`;
- STAR procedures, transitions and legs;
- altitude / speed constraints where present;
- staged AIRAC review and activation;
- `CHANGES FROM ACTIVE` summary instead of treating unconstrained legs as missing data.

Raw SQLite remains in the browser; structured procedure data is sent to the backend.

---

# System and test tools

- TEST TRAFFIC mode.
- System health summary and detailed drawer.
- Route ETA coverage.
- Processing-radius status.
- Pairwise separation invariant.
- AAR / next-hour demand and overload indication.
- Shared-state health.
- Ghost / reconnect health.
- Navdata admin and all-Thailand importer.

Verification references:

- `docs/AMAN_FOUR_CORE_VERIFICATION.md`
- `docs/MAESTRO_V24_VERIFICATION.md`

---

# Known limitations / validation still required

- Measure ETA-FF error against actual Feeder Fix crossings.
- Validate forecast-wind treatment beyond wind already reflected in live GS.
- Validate response to direct routing, shortcuts and radar vectors.
- Validate exact Thailand runway LAND SEP values and VTBS cross-runway stagger.
- Validate the 10 NM final detector against real IVAO approach tracks.
- Validate the first terminal-state ALDT proxy against actual touchdown / threshold time.
- Validate authoritative VTBD arrival capacity.
- Conduct two-controller simultaneous-edit testing.
- Conduct real disconnect / reconnect testing.
- Conduct 20–40 arrival load testing.
- Validate midnight UTC service-date rollover.

---

# Tech

- React 19 + TypeScript + Vite
- Cloudflare Pages Functions
- IVAO Tracker / flight-plan data
- AIRAC route geometry
- SimBrief performance profiles
- Supabase / PostgreSQL / Realtime

---

## Scope boundary

Current priority is Approach-side arrival sequencing. Wider E-AMAN, centre coordination, complete trajectory editing, extra-flight entry, CMAN, DMAN and AMAN–DMAN integration remain later phases unless their exact operational workflow is documented.
