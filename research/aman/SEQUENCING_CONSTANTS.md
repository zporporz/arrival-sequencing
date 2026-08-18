# Thailand AMAN — Temporary Sequencing Constants

**Baseline:** 2026-08-18  
**Evidence:** TH-SME / project-owner supplied operational values and screenshots.  
**Implementation status:** working hard-code baseline for the clean rebuild; keep centralised so values can be changed later.

---

## 1. Runway spacing and TLDT time conversion

Use **140 kt** as the temporary final-speed reference when converting configured runway spacing into a TLDT time-equivalent.

Formula:

`time_min = distance_nm / speed_kt × 60`

At 140 kt:

- 5 NM → **2.14 min**
- 5.5 NM → **2.36 min**
- 6 NM → **2.57 min**
- 7 NM → **3.00 min**
- 7.1 NM → **3.04 min**
- 8 NM → **3.43 min**

The configured value remains the NM spacing. The time value is derived for TLDT sequencing.

### Default runway spacing profiles

#### VTBD

| Runway | Default spacing | Time @ 140 kt |
|---|---:|---:|
| 21R | 5.0 NM | 2.14 min |
| 21L | 7.1 NM | 3.04 min |

#### VTBS

| Runway | Default spacing | Time @ 140 kt |
|---|---:|---:|
| 19 | 5.5 NM | 2.36 min |
| 20L | 8.0 NM | 3.43 min |
| 20R | 6.0 NM | 2.57 min |

These are default/operator settings, not immutable separation rules.

### Special aircraft values currently known

- ATR operational separation: **4 min** (described as about 10 NM).
- A380 distance setting: **7 NM** → **3.00 min @ 140 kt**.

How special-aircraft rules combine with the runway baseline is intentionally left for later clarification.

---

## 2. VTBS feeder / STAR nominal times

The supplied timing table contains separate `STAR19` and `STAR01` timing sets.

### STAR19 timing set

The project owner confirmed that **VTBS RWY 19 / 20L / 20R use the same STAR19 timing set**.

| Feeder / STAR head | Time to landing |
|---|---:|
| LEBIM | 21 min |
| DOLNI | 20 min |
| EASTE | 19 min |
| WILLA | 21 min |
| NORTA | 20 min |

The table also states **Short cut time reduce at least: 5 min** for STAR19.

### STAR01 timing set

| Feeder / STAR head | Time to landing |
|---|---:|
| LEBIM | 20 min |
| DOLNI | 17 min |
| EASTE | 19 min |
| WILLA | 24 min |
| NORTA | 22 min |

The table states **Short cut time reduce at least: 2 min** for STAR01.

Do not infer additional runway mapping for STAR01 until the owner confirms it explicitly.

---

## 3. VTBD feeder / STAR nominal times

Use the following supplied values as the current hard-code baseline:

| Fix / STAR head | Time |
|---|---:|
| NAKON | 13 min |
| WEHHA | 13 min |
| ENDUU | 17 min |
| SABAI | 20 min |
| SEHNA | 25 min |
| HOTEL | 21 min |
| TL | 18 min |
| UBLOD | 19 min |
| NODEG | 13 min |
| OPERA | 13 min |

### Explicit shortcut reductions in the supplied table

- ENDUU → OPERA: **reduce 4 min**
- SABAI → NODEG: **reduce 7 min**
- SEHNA → NODEG: **reduce 12 min**

These are stored as explicit shortcut relationships rather than being inferred from generic route geometry.

---

## 4. Holding point model

**TH-SME confirmed:** holding is at the **head of the STAR / feeder-entry point**.

For the rebuild, model the primary AMAN holding point as the STAR-entry / feeder fix unless a procedure-specific exception is later supplied.

---

## 5. Delay colour thresholds — current working baseline

For now, treat the following as the confirmed working implementation baseline; they may be changed later when better operational detail is supplied:

- `< 0 min` → Expedite
- `0 min` → Nothing
- `1–2 min` → Speed reduction
- `3–4 min` → Path Stretching
- `>= 5 min` → Holding

Keep these thresholds centralised in code and configuration.

---

## 6. Known deferred logic

Do **not** invent these yet:

- exact pairwise rule when ATR/A380/special wake interacts with runway spacing;
- multi-runway dependency/reallocation logic;
- go-around reinsertion;
- emergency/priority sequencing;
- runway-change behaviour;
- exact controller manual override workflow.

The owner has indicated some of these exist operationally but are difficult to describe from memory. Preserve them as deferred design questions rather than guessing.
