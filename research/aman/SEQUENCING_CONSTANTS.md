# Thailand AMAN — Temporary Sequencing Constants

**Baseline:** 2026-08-18  
**Evidence:** TH-SME / project-owner supplied operational values.  
**Implementation status:** temporary hard-code baseline for the clean rebuild; revisit when a published Thailand configuration/manual is available.

---

## TLDT gap / separation values

### Reference conversion

Use **140 kt** as the temporary final-speed reference when converting a runway spacing distance into a TLDT time gap.

Formula:

`time_min = distance_nm / speed_kt × 60`

At 140 kt:

- 5 NM → **2.14 min** (2 min 09 sec)
- 5.5 NM → **2.36 min** (2 min 21 sec)
- 6 NM → **2.57 min** (2 min 34 sec)
- 7 NM → **3.00 min**
- 7.1 NM → **3.04 min** (3 min 03 sec)
- 8 NM → **3.43 min** (3 min 26 sec)

The time value is a derived planning equivalent; the configured runway spacing itself remains the NM value.

### Default runway spacing profiles

These are the normal/default settings supplied for the current Thailand MAESTRO configuration. Controllers/settings may use different values, so the rebuild should eventually expose these as configuration rather than permanently hard-code them.

#### VTBD

| Runway | Default spacing | Time-equivalent @ 140 kt |
|---|---:|---:|
| 21R | 5.0 NM | 2.14 min |
| 21L | 7.1 NM | 3.04 min |

#### VTBS

| Runway | Default spacing | Time-equivalent @ 140 kt |
|---|---:|---:|
| 19 | 5.5 NM | 2.36 min |
| 20L | 8.0 NM | 3.43 min |
| 20R | 6.0 NM | 2.57 min |

These values match the supplied MAESTRO screenshot/configuration view.

### Normal generic gap

- Normal generic gap reference: **5 NM**.
- Reference final speed: **140 kt**.
- Time-equivalent: **2.14 min**.

### ATR separation

- **ATR separation = 4 min**.
- Operational description: approximately **10 NM**.
- Pure distance conversion at 140 kt for 4 min is about **9.33 NM**; keep the operational value as 4 min when ATR-specific separation applies.

### A380 separation

- Distance setting: **7 NM**.
- At 140 kt the time-equivalent is exactly **3.0 min**.

---

## Sequencing implementation rule

The runway spacing profile is a **setting**, not a universal fixed rule. For a given runway/configuration:

1. read the configured spacing in NM;
2. convert it to a time-equivalent using the working reference speed when a TLDT time gap is required;
3. apply any special aircraft-category rule (e.g. ATR/A380) where applicable;
4. later replace the temporary hard-coded defaults with editable airport/runway configuration.

The exact MAESTRO pairwise sequencing algorithm and how it combines runway spacing, wake turbulence, special aircraft categories, and runway dependencies still require confirmation.

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

No value has been supplied yet. **Do not infer a WILLA time from another feeder.** Keep WILLA unset/TODO until confirmed.

---

## Intended use

These values are temporary implementation constants for sequence/TLDT/TTO modelling. They are not claimed to be the internal MAESTRO configuration schema. Keep them centralised so they can be replaced by airport/runway configuration later without changing sequencing code in multiple places.
