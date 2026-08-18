# MAESTRO HMI / Settings Catalog

**Baseline:** 2026-08-18  
**Purpose:** inventory what is actually visible on Thailand MAESTRO material before designing the new UI.

This file deliberately separates **what is visible** from **what its exact operational meaning is**. Never promote an observed abbreviation into production logic without a confirmed definition.

---

## 1. Real HMI shape

### Centre AMAN Position

**TH-DECK / OBSERVED**

The AEROTHAI presentation shows a dedicated AMAN workstation with a tall portrait-like MAESTRO display beside a surveillance display. The main MAESTRO object is a **vertical time line** with flights distributed along time, rather than a conventional CRUD table.

Characteristics visible in the source:

- dark blue/navy background;
- central vertical time rulers/ticks;
- current/future landing plan arranged against the time ruler;
- callsign/type/feeder/target/delay/runway information compressed into one line;
- multiple streams/columns visible on the same tall display;
- sparse colour used to draw attention rather than decorate the interface.

### Controller Working Position (BACC)

**TH-DECK / OBSERVED**

At a normal controller working position, MAESTRO appears in a window together with several smaller traffic-list panels. The operational layout is modular/windowed: main AMAN timeline + inbound/ETA/ETO/departure lists.

---

## 2. Main sequence row

**TH-SME / OBSERVED**

Confirmed row order from the supplied Thailand screenshot:

| Order | Field | Confirmed meaning | Evidence |
|---:|---|---|---|
| 1 | `TLDT` | Target Landing Time | TH-SME / observed |
| 2 | Callsign | Aircraft identification | TH-SME / observed |
| 3 | Type | Aircraft type | TH-SME / observed |
| 4 | STAR / IAWP code | Compact feeder/STAR family code | TH-SME / observed |
| 5 | `TTO` | Target Time Over feeder/STAR entry | TH-SME / observed |
| 6 | Delay Required | Time to be absorbed/gained to meet target | TH-SME / observed |
| 7 | Runway | Landing runway | TH-SME / observed |

### VTBS compact feeder codes

**TH-SME**

| Code | IAWP |
|---|---|
| `E` | EASTE |
| `T` | TUMGA |
| `L` | LEBIM |
| `N` | NORTA |
| `W` | WILLA |

For VTBD, equivalent compact codes have not yet been explicitly confirmed by the SME even though the five IAWP names are known from CAAT AIP. Do not invent the one-letter display mapping unless confirmed.

---

## 3. Delay colour coding

**OBSERVED**

| Colour | Action label | Meaning at concept level | Numeric threshold |
|---|---|---|---|
| Green | Expedite | Need to gain time / arrive earlier | **UNKNOWN** |
| Grey/white | Nothing | No meaningful tactical action | **UNKNOWN** |
| Yellow | Speed reduction | Absorb delay primarily by speed | **UNKNOWN** |
| Orange | Path Stretching | Larger delay; extend route/path | **UNKNOWN** |
| Red | Holding | Delay requires/justifies holding | **UNKNOWN** |

**Rule for implementation:** action categories may be modelled now; thresholds must remain configuration/TODO until Thailand data confirms them.

---

## 4. Flight stability/status coding

**TH-DECK — exact published Thailand values**

| Status | Trigger | Approx. range shown in AEROTHAI deck |
|---|---|---|
| Unstable | 1 min after flight creation from ABI | 300–200 NM from BKK VOR |
| Stable | 15 min before IAWP | 200–90 NM |
| Superstable | 5 min before IAWP | 90 NM–10 NM final |
| Frozen | 4 min before landing | 10 NM final |

The slide itself uses different colour blocks for these states. The exact RGB/HMI colour values are not important; semantic status is.

### Unknown behaviours

- Whether Frozen prevents editing.
- Whether manual controller action can return a flight to an earlier stability state.
- Whether different airports/settings use different time thresholds.
- How go-arounds/missed approaches reset status.

---

## 5. Top configuration area visible on MAESTRO CWP

**OBSERVED — semantics only partially known**

The supplied real screenshot shows a configuration/header strip above the timeline. Examples visible include:

- runway mode strings such as `21L_DEP/21R_ARR`;
- runway-specific boxes such as `21R: 5.0 NM` and `21L: 7.1 NM` in one screenshot;
- other runway/stream boxes with an NM value;
- `ΔT` shown below some spacing values;
- an `Earliest` control/label;
- counters/labels resembling `TMA`, `TOT`, `HLD`;
- a configuration string containing runway/mix information;
- navigation/context buttons/tabs such as `MAESTRO`, `ACC NORTH`, `CMA APP`, `1N`, `2N`, `3N`.

### Settings catalog

| Visible item | Example | What we can safely say | Exact semantics |
|---|---|---|---|
| Runway mode | `21L_DEP/21R_ARR` | Defines operational runway role/config context | Mostly clear; exact rule set unknown |
| Runway spacing box | `21R: 5.0 NM` | A runway/stream-specific distance setting is displayed | Exact separation source/application unknown |
| Another spacing box | `21L: 7.1 NM` | Different runway/stream may use a different setting | Exact dependency unknown |
| `ΔT` | values displayed under boxes | Time-delta-related setting/indicator | **UNKNOWN** |
| `Earliest` | text/button | Earliest-related planning function exists in HMI | **UNKNOWN** |
| `TMA` | numeric count | A TMA-related counter/parameter is visible | **UNKNOWN** |
| `TOT` | numeric count | A TOT-related counter/parameter is visible | **UNKNOWN** |
| `HLD` | numeric count | A holding-related counter/parameter is visible | Exact count semantics unknown |
| `MAESTRO` | selected tab | MAESTRO context/view selector | clear at UI level |
| `ACC NORTH` | tab/button | Controller/sector context selector | exact filtering behaviour unknown |
| `CMA APP` | tab/button | APP context selector | exact filtering behaviour unknown |
| `1N/2N/3N` | tabs/buttons | stream/sector/config selector | **UNKNOWN** |

Do not translate these observations into database fields until definitions are confirmed.

---

## 6. Inbound list visible on CWP

**OBSERVED**

A top-right panel is labelled similar to `Inbound:9 ETN` and contains columns:

- `ACID`
- `NFL`
- `ETN`
- `CFL`
- `RFL`
- `ATYP`
- `LFUNC`

### Confidence table

| Column | Safe interpretation | Confidence |
|---|---|---|
| ACID | Aircraft ID / callsign | High |
| ATYP | Aircraft type | High |
| CFL | likely a flight-level field, but exact installed-system definition should be confirmed | Unverified |
| RFL | likely a requested/reference flight-level field, exact definition to confirm | Unverified |
| NFL | **do not guess** | Unknown |
| ETN | **do not guess**; panel title suggests an estimated-time/entry concept | Unknown |
| LFUNC | **do not guess** | Unknown |

There are generic ATM conventions that could explain some abbreviations, but those conventions are not sufficient proof of the Thailand MAESTRO implementation.

---

## 7. Supporting panels visible on BACC CWP

**TH-DECK / OBSERVED**

The real CWP screenshot contains several independent windows. Visible examples include:

### Arrival ETA lists

A panel label such as:

`VTCC : ARRIVAL:10 ETA`

shows flight rows with arrival-related information. This supports the concept of keeping **other airport/sector arrival awareness** outside the main AMAN sequence.

### Departure EOBT lists

A panel label such as:

`VTCT : DEPARTURE:2 EOBT`

shows departure traffic. This supports the project idea of a small departure panel beside the arrival timeline, but it should remain a secondary awareness tool rather than being mixed into the landing sequence.

### ETO lists

Other windows are labelled with ETO-like context. Exact panel filter/column semantics are not fully readable in the available screenshots.

### Design rule

Build supporting panels as modular components. Do not assume every BACC window must appear at every airport or controller position.

---

## 8. Timeline characteristics to reproduce conceptually

**OBSERVED**

The actual MAESTRO sequence is dominated by time, not by a row number.

Useful characteristics for a web HMI:

- vertical UTC time scale;
- aircraft placed relative to the target timeline;
- current-time marker;
- target landing time visually prominent;
- compact target-over time;
- feeder/IAWP code shown with minimal width;
- delay-required value visually salient;
- runway displayed at the end of the line;
- dense layout capable of many aircraft without oversized cards;
- ability to identify sequence gaps and bunching by eye.

### What not to copy literally

The old MAESTRO graphics were built for a specialised workstation and low-resolution operational display. The web rebuild should preserve **information hierarchy and scanning behaviour**, not blindly copy every pixel/font.

---

## 9. Configuration model recommended for the rebuild

This is a product/data model proposal informed by the research. It is not claimed to be the MAESTRO internal schema.

### Airport profile

- ICAO
- display name
- timezone/display time convention
- enabled AMAN status

### Runway configuration profile

- config ID/name
- arrival runway(s)
- departure runway(s)
- runway role/mixed-mode definition
- default arrival flow rate
- per-runway/per-stream spacing settings
- effective date/time
- activation status

### Arrival stream profile

- IAWP
- compact code
- applicable inbound routes/transitions
- applicable STAR families
- holding fix if any
- nominal/trajectory model from IAWP to runway

### Sequence rules

- planning horizon
- sequence optimisation objective
- min/max runway rate
- pairwise/wake spacing matrix
- slot reservation/blocking
- manual sequence override policy
- runway reassignment policy

### Stability rules

- flight creation trigger/horizon
- Stable trigger
- Superstable trigger
- Frozen trigger
- allowed edits at each state

### Advisory rules

- time gain/lose tolerance
- Expedite threshold
- Nothing band
- Speed reduction band
- Path stretching band
- Holding band
- maximum practical delay absorption before hold

All fields not backed by a Thailand source should remain editable configuration/TODO rather than hardcoded assumptions.

---

## 10. Interaction functions to investigate before implementation

Generic AMAN systems commonly provide manual editing/what-if tools, and the Thailand HMI clearly contains controls, but the exact MAESTRO interactions are still not documented in the source set.

Need Thailand confirmation for:

- drag/reorder aircraft in timeline;
- target-time edit;
- swap two aircraft;
- insert slot/gap;
- reserve runway slot;
- runway reassignment;
- force/lock/freeze flight;
- exclude/cancel flight;
- put flight into holding and select holding fix;
- set/override delay action class;
- change runway arrival rate;
- change spacing per runway/stream;
- temporary runway closure/block;
- go-around reinsertion;
- emergency/priority handling;
- “what-if” mode versus live plan.

Until confirmed, the first clean implementation should prioritise **display and data correctness** over adding a large control surface.

---

## 11. Visual hierarchy recommendation

Based on the real BACC screenshots:

1. **Top operational strip** — airport, runway configuration, rate/spacing/state, clock/user.
2. **Main left/centre** — time-based arrival sequence.
3. **Right top** — inbound not yet fully sequenced / inbound planning list.
4. **Right lower** — departure awareness and optional other-airport ETA/ETO panels.
5. **Bottom/side legend** — delay/advisory colours and stability information.
6. **Detail drawer/popover** — FPL, full STAR, ETO prediction, route, source/quality/debug data.

The detail layer should not pollute the timeline. Controllers need to scan the sequence first.
