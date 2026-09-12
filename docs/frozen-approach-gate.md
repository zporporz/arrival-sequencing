# Frozen approach gate

Applies to all currently supported AMAN airports: VTBD, VTBS, VTCC and VTSP.

- A fresh airborne sample within **10 NM radial distance of the assigned landing
  threshold**, on a supported published approach, may enter Frozen while still
  turning onto final. It does not need to face the runway already.
- Supported paths are continuous IF/TF/CF legs ending at the threshold. Matching
  checks the local leg/corner heading, a 0.8 NM lateral corridor, altitude and
  climb-out indicators. These are conservative geometric heuristics, **not proof
  of an approach clearance**. Coincident ILS/RNAV variants are accepted only when
  their remaining distances agree within 1 NM. Regional approach selection is
  respected; materially ambiguous paths are not guessed.
- The server rechecks its stored IVAO snapshot against the active AIRAC package.
  `TLDT = snapshot time + remaining approach path / category reference speed`.
  The remaining path includes downstream bends and can exceed 10 NM. It is a
  no-wind, constant-category-speed EST, not a turn-radius/acceleration simulation.
- ETA-FF locking, separation and manual sequencing retain their existing rules.
  Same-runway Frozen capture remains first-writer-wins and shared with late
  joiners. All four airports recapture after a runway change. GA clears the latch.
- RF/AF arcs, holds, vector/discontinuous legs, short MAP-to-runway gaps, or
  unavailable/mismatched AIRAC data do not acquire a guessed path. The existing
  aligned Final gate remains available (now also constrained to 10 NM radial).
- Detection happens on the **first qualifying received sample**, not at an exact
  interpolated 10.000 NM crossing. IVAO feed age and the 15-second polling interval
  still limit when the UI can observe that crossing.

## Data refresh and rollout

Generate the private package from the same SQLite used for the active AIRAC:

```powershell
node scripts/extract-regional-navdata.mjs <little_navmap_navigraph.sqlite> --final-approaches
```

The package is served behind the sequence authentication middleware; it is not a
public browser asset. Both cycle and source SHA-256 must match the active DB cycle.
Regenerate this package along with regional-arrivals on subsequent AIRAC updates.

Apply `20260912142835_add_frozen_approach_path.sql` **before** deploying the updated
API. It only adds nullable audit fields; existing captures are not recalculated.
Keep those columns if rolling back the app, so existing/old clients remain valid.

Regression suites: `approach-gate.test.js`, `approach-gate-runtime.test.ts`,
`approach-gate-server.test.js`, plus the existing lifecycle/runway/GA tests.
