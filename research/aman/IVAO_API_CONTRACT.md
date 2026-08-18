# IVAO API Contract for Approach AMAN

**Baseline:** 2026-08-18
**Source:** user-supplied IVAO Tracker API schema (`FlightPlanDto`, `AircraftSummaryDto`).

The IVAO Tracker API already exposes the core flight-plan fields required for the Approach AMAN rebuild.

## Flight-plan timing

`FlightPlanDto` includes:

- `eet` — number, time in seconds
- `departureTime` — number, time in seconds
- `actualDepartureTime` — number, time in seconds

For the rebuild:

- `departureTime` is the filed departure-time / EOBT-equivalent timing input;
- `eet` provides the filed elapsed-time input;
- `actualDepartureTime`, when populated and trustworthy, is available as an actual-departure timing source;
- live track / route-position ETA remains the preferred tactical estimate once airborne.

## Aircraft / wake data

`FlightPlanDto.aircraft` is an embedded `AircraftSummaryDto` containing:

- `icaoCode`
- `model`
- `wakeTurbulence`
- `military`
- `description`

Therefore no separate external wake-category provider is required for the MVP. Use `aircraft.wakeTurbulence` directly for wake/separation classification, with aircraft ICAO type available from `aircraft.icaoCode` / `aircraftId`.

## Implemented project API contract

`/api/sequence/ivao-traffic` now enriches inbound traffic with the detailed IVAO flight plan and exposes the AMAN inputs needed by the clean core:

- `filedDepartureTimeSeconds`
- `actualDepartureTimeSeconds`
- `filedEetSeconds`
- `wakeTurbulence`
- `aircraft`
- `route`
- `onGround`
- `trackTimestamp`
- latitude / longitude / altitude / groundspeed / heading
- flight-plan ID and revision
- legacy tracked-takeoff fields retained for fallback compatibility

Detailed-flight-plan calls are cached and concurrency-limited so opening a busy arrival airport does not fire an unbounded request burst.

## ETA engine implementation

`src/core/arrivalEta.ts` implements the progressive IVAO estimate priority:

1. live route/track ETA to IAWP;
2. `actualDepartureTime + EET - nominal STAR time`;
3. tracked takeoff + EET - nominal STAR time;
4. filed `departureTime + EET - nominal STAR time` as low-confidence provisional timing.

## Sequencing engine implementation

`src/core/arrivalSequencing.ts` provides the first clean AMAN sequencing core:

- natural landing time from predicted IAWP + nominal STAR time;
- full timestamp precision for ordering;
- automatic Unstable sequencing by configured runway separation;
- optional pairwise-separation hook for future ATR/A380/wake rules;
- TLDT/TTO calculation;
- Delay Required calculation and action classification;
- signed average Delay Required (`ΔT`).

No additional external API is required before continuing the Approach AMAN engine/UI build.
