# VTBS north flow

In **VTBS CONFIG**, select a preset containing `01 / 02L / 02R`, for example
`SEMI35 · 01MIX · 02RDEP · 02LARR`. Only the selected direction's three runway
cards are shown. South flow (`19 / 20L / 20R`) remains the initial default.
Changing an individual mode produces `CUSTOM` without losing the direction.
The shared workspace persists that direction for other controllers and late joiners.

North flow uses the existing STAR01 nominal FF-to-landing times:

| FF | Minutes |
| --- | ---: |
| LEBIM | 20 |
| TUMGA | 17 |
| EASTE | 19 |
| WILLA | 24 |
| NORTA | 22 |

Published master timings, when present, must match `01_02` exactly. An absent
north master workspace uses the table above, never a sole south-flow workspace.
A published matching workspace with a missing fix still reports NO TIMING.
These remain nominal working times, not live vector-path measurements.

The FF lock is retained; the selected flow supplies the STAR duration for TLDT /
STA-FF. Old-direction Frozen and AUTO-return target overrides are not reused.
Final geometry is re-evaluated for the assigned runway. A fresh Frozen capture
on a changed VTBS runway uses a revision-conditional write.

North LAND SEP starting values are configurable working defaults copied from
the reciprocal physical runway, **not independently verified north-flow minima**:
01 = 5.5 NM (19), 02L = 6 NM (20R), 02R = 8 NM (20L).
RESET LAND SEP resets only the currently selected flow.

Browser and server share the same [CAAT AD 2.12 threshold coordinates / true bearings](https://aip.caat.or.th/2026-05-14-AIRAC/html/eAIP/VT-AD-2.VTBS-en-GB.html)
for Final-10 and automatic missed-approach detection.

Validation: `npm run build`; north-flow regressions live in
`tests/vtbs-north-flow.test.tsx` and `tests/vtbs-north-server.test.js`.
No database migration or change of the live operational flow is required by this code update.
