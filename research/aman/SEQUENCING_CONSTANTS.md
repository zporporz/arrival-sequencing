# Thailand AMAN — Temporary Sequencing Constants

**Baseline:** 2026-08-18  
**Evidence:** TH-SME / project-owner supplied operational values.  
**Implementation status:** temporary hard-code baseline for the clean rebuild; revisit when a published Thailand configuration/manual is available.

---

## TLDT gap / separation values

### Normal TLDT gap

- Operational gap setting: **5 NM = 2.8 min**.
- Reference speed supplied with the setting: **140 kt**.

Important: this project stores **2.8 min as the operational AMAN gap setting supplied by the SME**. It should not be silently replaced by a pure distance/speed conversion. A simple 5 NM / 140 kt calculation would be about 2.14 min, so the 2.8 min value may include an operational/configuration assumption that is not yet documented.

### ATR separation

- **ATR separation = 4 min**.
- Operational description: approximately **10 NM**.
- Pure distance at 140 kt for 4 min is about **9.33 NM**, which is consistent with the stated ~10 NM approximation.

### A380 separation

- Distance setting: **7 NM**.
- At the same 140 kt reference speed, pure time conversion is exactly **3.0 min**.

Formula:

`time_min = distance_nm / speed_kt × 60`

`7 / 140 × 60 = 3.0 min`

Until a Thailand MAESTRO-specific time value is supplied, use **3.0 min** as the temporary A380 time-equivalent when the implementation needs a time value derived from the 7 NM rule.

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
