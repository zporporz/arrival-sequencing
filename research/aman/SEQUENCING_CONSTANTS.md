# Thailand AMAN — Temporary Sequencing Constants

**Baseline:** 2026-08-18  
**Evidence:** TH-SME / project-owner supplied operational values.  
**Implementation status:** temporary hard-code baseline for the clean rebuild; revisit when a published Thailand configuration/manual is available.

---

## TLDT gap / separation values

### Normal TLDT gap

- Normal gap setting: **5 NM**.
- Reference final speed: **140 kt**.
- Time-equivalent: **2.14 min** (about 2 min 9 sec).

Formula:

`time_min = distance_nm / speed_kt × 60`

`5 / 140 × 60 = 2.142857... min`

For the temporary AMAN model, use **2.14 min** as the 5 NM TLDT gap time-equivalent at 140 kt.

### ATR separation

- **ATR separation = 4 min**.
- Operational description: approximately **10 NM**.
- Pure distance at 140 kt for 4 min is about **9.33 NM**, which is consistent with the stated ~10 NM approximation.

### A380 separation

- Distance setting: **7 NM**.
- At the same 140 kt reference speed, the time-equivalent is exactly **3.0 min**.

`7 / 140 × 60 = 3.0 min`

Therefore the current temporary values are:

- 5 NM → **2.14 min** @ 140 kt
- 7 NM → **3.00 min** @ 140 kt
- 10 NM → **4.29 min** @ 140 kt (distance conversion only; ATR operational value remains 4 min)

---

## VTBS IAWP / STAR nominal times

Temporary hard-coded nominal times from feeder/IAWP to landing for the clean rebuild:

| VTBS IAWP | Nominal time |
|---|---:|
| EASTE | 18 min |
| NORTA | 20 min |
| LEBIM | 18 min |
| TUMGA | 20 min |

### WILLA

No value was supplied in this update. **Do not infer a WILLA time from another feeder.** Keep WILLA unset/TODO until confirmed.

---

## Intended use

These values are temporary implementation constants for sequence/TLDT/TTO modelling. They are not claimed to be the internal MAESTRO configuration schema. Keep them centralised so they can be replaced by airport/runway configuration later without changing sequencing code in multiple places.
