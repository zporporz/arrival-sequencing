# VTBD 03 flow — nominal timing baseline

This adds an optional 03L/03R flow. The initial view and VTBD 21 timings remain unchanged.
Select `DUAL 03LARR 03RARR`, `03LARR 03RDEP`, or `03RARR 03LDEP` in VTBD CONFIG.
The existing shared workspace stores its direction, runway modes and LAND SEP; no schema migration.

## Timing provenance

Computed on 2026-09-12 with the existing regional timing model from the supplied Little Navmap Navigraph AIRAC 2609 SQLite.
Nominal A320 SimBrief descent `78/300/250`, category C, no wind, full published route and altitude/speed constraints.
STARs ENDU1B, NAKO1B, SABA1B, SEHN1B and WEHA1B end at DOTLI.
Assumed approaches: ILS Z 03L (`I03LZ`) and RNP 03R (`R03R`), via DOTLI/KAGET/BONDU.
The separate ILS Y 03L and VOR 03R paths are not included in this model.

| Entry fix | Computed 03L seconds | Computed 03R seconds | Working nominal | Existing 21 |
| --- | ---: | ---: | ---: | ---: |
| ENDUU | 1560.94 | 1560.85 | 26:00 | 17:00 |
| NAKON | 1348.57 | 1348.49 | 22:30 | 13:00 |
| SABAI | 896.39 | 896.31 | 15:00 | 20:00 |
| SEHNA | 1207.42 | 1207.35 | 20:00 | 25:00 |
| WEHHA | 1287.90 | 1287.82 | 21:30 | 13:00 |

DOTLI to threshold is approximately 8:20. Working values are rounded to half-minutes and shared by 03L/03R.
These are static EST baselines, not observed flight times, not individual aircraft-type calculations and not automatically regenerated at AIRAC activation.
Controller vectors, wind, holding and actual speed may differ. A published master for exact flow `03` takes precedence;
the app never borrows a sole `21` master or its OPERA/NODEG shortcut timings for `03`.

## Sequence and lifecycle

- Before Frozen, AUTO landing time uses ETA-FF plus the selected flow's nominal duration, with existing sequencing/separation.
- Switching direction recalculates the duration without carrying opposite-flow Frozen/AUTO/manual timestamps into the new flow. ETA-FF lifecycle remains unchanged.
- Frozen detection uses the assigned runway threshold and heading within Final 10 NM. The capture recalculates TLDT as track time plus distance/category reference speed, shared with revision protection. Same-runway captures stay fixed; manual sequencing remains available.
- Final/GA geometry uses CAAT AIP VTBD AD 2.12 threshold coordinates and true bearings (03L 029°, 03R 028°): https://aip.caat.or.th/2026-09-03-AIRAC/html/eAIP/VT-AD-2.VTBD-en-GB.html
- 03L LAND SEP starts at 5 NM and 03R at 7.1 NM, copied from physical reciprocal ends 21R/21L. These are configurable working defaults, not verified north-flow operational minima. RESET affects only the displayed direction.
- Civil callsigns prefer 03L; existing special callsign prefixes prefer 03R. VTBD remains one airport-wide arrival stream, not two independent queues.

Validation: VTBD/VTBS flow regression tests, shared-state and late-join tests, Final/Frozen/GA tests, full build and Pages Functions bundle check. No live workspace writes are required to test the feature.
