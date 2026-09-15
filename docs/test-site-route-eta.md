# Test-site route ETA repair

Scope: `zporporz/arrival-sequencing` / `atc-sequence.pages.dev` only. No Plesk,
Supabase schema, credentials, persisted flight records, or controller targets are
migrated by this change.

## Changes

- Send the same automatic/manual arrival runway used by the displayed sequence
  to the route API. A manual runway change is used on the next traffic refresh.
- Include runway and entry fix in client request/cache identity; expire entries
  after 60 seconds so the server can revalidate the active AIRAC. Scope Recompute
  clears this cache. Failed geometry remains a labelled fallback, not a flight-long cache.
- Convert standalone `DCT` separators for AIRAC's consecutive-fix parser, keeping
  the original filed route intact and verifying direct fix pairs in its response.
  Unknown waypoints, airways, invalid coordinates and discontinuities still fail.
- Share all 35 airport-specific feeder mappings between label resolution and
  geometry resolution. Only a known terminal fix can be extended. Later unknown
  fixes/STARs or a mismatched entry are never removed to force a match.
- Preserve intermediate fixes (e.g. VTBS ANREN/DULEM via GOMES to TUMGA).
  Coordinates and distances must resolve in the current AIRAC. These are
  **inferred published feeder routes, not confirmed STAR clearances**.
- Reject geometry that never reaches the requested entry. Display `ENTRY EST`,
  `FPL EST`, and `LOCKED` as applicable in Inbound; hover for source/error details.

## Validation

Run `npm run build` and `npm run check:pages`. Tests cover DCT, all feeder
mappings, intermediate legs, unknown/missing data, partial-route AIRAC matching,
runway/cache changes, visible fallback labels, cruise position ETA recovery and
the existing STABLE/manual-target lifecycle.

On 2026-09-15, read-only checks against AIRAC 2609 resolved all 35 feeder paths
without parser warnings. Both of these reported routes also resolved with VTBD
21R and SABAI entry:

```text
DCT TRN W24 BITEN Y99 HOTEL DCT SABAI SABAI3A
DCT TRN W24 BITEN Y99 HOTEL
```

## User acceptance before porting to Plesk

1. Refresh the test site. Observe an airborne cruise flight before its existing
   STABLE window; hover Inbound to check `LIVE_ROUTE`, remaining distance and
   fresh track samples. Compare multiple samples, not just the ticking clock.
2. Try filed STAR, explicit entry without STAR, and terminal feeder-only routes
   across both VTBD and VTBS. Feeder-only results should say `ENTRY EST`.
3. Change the flight's assigned runway and allow one traffic tick (15 seconds).
   Check the route request's `arrivalRunway` matches the displayed assignment.
4. An unresolved route must show `FPL EST` (or no usable ETA), with an explanation
   in the row details; it must not be presented as verified live geometry.

Existing STABLE locks, historical fix-crossing latches, canonical sync and manual
STA/TLDT targets are intentionally unchanged. A previously locked time can remain
locked after this update. ATC DCT/vector clearances absent from the data feed are
not automatically inferred from this fix, nor is a particular STAR variant
invented when the pilot files only an upstream fix.

## Source contracts

- [AIRAC route parser documentation](https://airac.net/): consecutive waypoint
  distances, runway options, current-cycle header. Query JSON, not scraped HTML.
- [CAAT AIP ENR 1.10 §4.3, 2026-07-09 edition](https://aip.caat.or.th/2026-07-09-AIRAC/html/eAIP/VT-ENR-1.10-en-GB.html):
  existing airport feeder table, now preserving the full connecting path. Keep
  this versioned table reviewed with future AIP changes; geometry verification
  alone does not prove a route clearance or operational applicability.
