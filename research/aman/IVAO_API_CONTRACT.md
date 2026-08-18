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
- `actualDepartureTime`, when populated and trustworthy, should be preferred over reconstructing actual departure from track history;
- live track / route-position ETA remains the preferred tactical estimate once airborne.

## Aircraft / wake data

`FlightPlanDto.aircraft` is an embedded `AircraftSummaryDto` containing:

- `icaoCode`
- `model`
- `wakeTurbulence`
- `military`
- `description`

Therefore no separate external wake-category provider is required for the MVP. Use `aircraft.wakeTurbulence` directly for wake/separation classification, with aircraft ICAO type available from `aircraft.icaoCode` / `aircraftId`.

## API conclusion

For the Approach AMAN MVP, the existing IVAO Tracker API is sufficient for:

- callsign / aircraft type;
- origin / destination;
- route;
- filed departure time;
- filed EET;
- actual departure time;
- wake turbulence category;
- airport coordinates;
- live track/position data through Tracker endpoints;
- track history when fallback takeoff detection is needed.

The remaining work is implementation: expose these fields through the project's `/api/sequence/ivao-traffic` response and consume them in the sequencing engine. No additional external API is required before engine work starts.
