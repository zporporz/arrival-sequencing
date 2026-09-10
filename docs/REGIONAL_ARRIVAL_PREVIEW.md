# Regional arrival timing preview

Status: experimental, not the operational shared sequence. Open `/?regional=VTCC`
or `/?regional=VTSP`, behind the normal IVAO login. The main AMAN header links here.
VTBD/VTBS timing, locks, manual targets, realtime and sequencing are unchanged.

## What is available

- Published STAR waypoints, speed/altitude point constraints, connected approach
  legs and runway geometry from the supplied Little Navmap Navigraph AIRAC 2609.
- Existing SimBrief aircraft-type descent profiles and approach category.
- A nominal, no-wind per-leg time calculation, with an explicit assumed approach.
- A live arrival table ordered by estimated landing time, with visible reasons
  when an aircraft cannot be timed. A route calculator also works with no traffic.
- Current airborne position, track direction and GS select progress along the
  published route. Before the STAR, a resolved filed route must connect to the
  entry fix. On the STAR, only the remaining path is timed. A late-opened browser
  does not fabricate a past FF crossing time or reuse EOBT + EET.
- ETA-FF and STA-FF have the same value only because this preview does NOT yet
  allocate slots. Once past entry, no historical FF time is invented.

## Assumptions and deliberate limits

The model uses an ISA IAS-to-TAS approximation, a constrained nominal 3-degree
descent with level segments, SimBrief speed schedule caps (including within a leg
crossing 10,000 ft), and an explicit category-based final-speed assumption. Profiles
are speed schedules, not a complete mass/configuration/descent-performance model.
Fly-by corners and accelerations are approximate. No wind forecast is included.
The last leg reaches the published runway threshold; displayed TLDT is a proxy
for landing time and does not model flare/touchdown displacement.

Supported default connections in this package:

| Airport | Runway | Approach |
| --- | --- | --- |
| VTCC | 18 | R18 |
| VTCC | 36 | I36-Z |
| VTSP | 09 | R09-Y |
| VTSP | 27 | I27 |

All 45 STARs in these four configurations are exercised against those connections.
Other approaches can be selected but are rejected when the published connection,
runway final segment or supported geometry is missing. VM/FM vectors, RF/AF arcs,
holding, disconnected paths and unsupported constraints are NOT approximated with
straight-line shortcuts. Ground and terminal flights, stale tracks, ambiguous path
crossings, missing profiles, off-route tracks and major altitude mismatches do not
receive an ETA. This is not automatic operational GA/IAP processing.

No dragging, stage locking, wake separation, shared manual/AUTO targets, canonical
baselines or realtime collaboration is enabled on the regional page. Calibration
against flown arrivals and a deliberate integration of those operational features
are required before promoting this to the main shared AMAN timeline.

## Data and isolation

`functions/_data/regional-arrivals.json` is a generated companion package because
the current staff import stores STARs, not approach legs/runway geometry. It is NOT
imported by the client build or placed in public static assets. The authenticated
`/api/sequence/regional-navdata` endpoint requires both the active cycle AND source
SHA-256 to match the package. Mismatch returns 409, verification failure 503.
Every traffic refresh checks the active cycle again. Raw SQLite is never modified.
Handle source-derived navdata according to the source licence and repository access.

`ivao-traffic?airport=VTCC|VTSP&mode=regional-preview` bypasses shared flight
reconciliation. The exception cannot disable normal VTBD/VTBS reconciliation.
Existing SimBrief type-profile cache refreshes may still update the existing
`aircraft_performance_profiles` cache; no regional flight/queue records are written.
There are no schema changes, new services, scheduled jobs or external deployments.

## Regenerating for a new AIRAC

Use Node 22.13+ (tested with Node 24), with the exact SQLite source staged/activated
by staff:

```powershell
node scripts/extract-regional-navdata.mjs 'C:/Aurora/Data/Navigraph/2609/little_navmap_db/little_navmap_navigraph.sqlite'
npm run build
node node_modules/wrangler/bin/wrangler.js pages functions build --outdir tmp/regional-functions-check --compatibility-date 2026-09-01
```

Review changed procedure names, restrictions and default approach connections.
Regeneration and a reviewed application deployment are currently required; merely
activating a different cycle does not update this companion package. The preview
will show unavailable instead of mixing cycles. This does not disable VTBD/VTBS.

## Local verification

```powershell
node scripts/preview-regional.mjs
```

Open `http://127.0.0.1:5187/?regional=VTCC`. This separate local-only dev script
serves labelled TEST traffic/profile fixtures and a mock login. It does not contact
production or read secrets and is never imported by the production build.

Tests cover real source connections, point constraints, profile/wind sensitivity,
unavailable data, airborne-connect timing, track-time anchoring, API authentication,
AIRAC fail-closed behavior, operational isolation, and UI airport switching.
