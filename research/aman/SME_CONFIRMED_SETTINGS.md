# Thailand MAESTRO — SME Confirmed Settings

**Baseline:** 2026-08-18  
**Evidence:** TH-SME — operational information supplied directly through the project owner.

This file records Thailand-specific MAESTRO meanings confirmed for the project. Some values are working operational baselines and may be revised later when the owner supplies more exact detail.

---

## ΔT — Average Delay

**Confirmed meaning:** `ΔT` is the **average delay of the aircraft in the arrival sequence / STAR flow**.

Conceptually:

`ΔT = sum of aircraft Delay Required values / number of aircraft included`

It is an aggregate/summary indicator derived from the per-aircraft Delay Required values, not another target time.

Still to refine later:

- exact population/filter used in the average;
- whether negative/Expedite values are included as signed values;
- whether scope is airport/runway/STAR/IAWP/view-specific.

---

## TMA — Aircraft currently inside the TMA

**Confirmed meaning:** `TMA` shows **how many aircraft are currently inside the TMA** for the relevant MAESTRO context.

### Bangkok working boundary for the IVAO rebuild

For the current Approach-only rebuild, use a **50 NM radius from BKK VOR** as the working Bangkok TMA counting boundary.

This gives a practical implementation model using IVAO aircraft latitude/longitude and a BKK VOR reference coordinate. It is a project operational simplification for the counter and is not intended to reproduce every vertical/lateral legal boundary of Bangkok TMA airspace.

Treat `TMA` as a live calculated counter.

---

## HLD — Aircraft currently holding

**Confirmed meaning:** `HLD` shows **how many aircraft are currently holding** for the relevant MAESTRO context.

### Holding location

**Confirmed:** the operational holding point is at the **head of the STAR / feeder-entry point**.

### MAESTRO presentation / leave-hold concept

For the controller, the important output is primarily the **red Holding indication** plus an expected/target leave-hold time. If the aircraft must absorb another 5 minutes in hold, the expected leave-hold time is effectively moved 5 minutes later.

Example concept:

- current/previous target leave time = 10:20
- another 5 min must be absorbed in hold
- revised expected leave-hold time = 10:25

The real radar/track behaviour is still monitored by ATC; MAESTRO provides the sequencing/time indication rather than physically detecting or commanding the manoeuvre itself.

### IVAO implementation still to decide

IVAO does not directly provide a definitive "ATC has instructed HOLD" state. For the rebuild, the project still needs to choose whether HLD is:

- manually marked by the controller; or
- inferred from aircraft track behaviour around the holding fix; or
- a hybrid where manual state is authoritative and track behaviour is advisory.

---

## TOT — Total traffic inbound in system

**Confirmed label/meaning:** `TOT` means **Total traffic inbound in system**.

For the IVAO rebuild, the current working interpretation is the total inbound traffic currently connected/known with destination matching the selected airport, including traffic still outside the TMA.

Conceptually:

- `TOT` = all inbound traffic in the AMAN population;
- `TMA` = subset currently inside the 50 NM Bangkok working boundary;
- `HLD` = subset currently holding.

Exact lifecycle details for disconnect, landing, diversion and go-around can be refined later.

---

## Delay colour thresholds — working confirmed baseline

The Thailand MAESTRO HMI uses:

- Green — Expedite
- White/grey — Nothing
- Yellow — Speed reduction
- Orange — Path Stretching
- Red — Holding

For the current rebuild, use the following **working threshold baseline** until a more exact operational table is supplied:

- `< 0 min` → Expedite
- `0 min` → Nothing
- `1–2 min` → Speed reduction
- `3–4 min` → Path Stretching
- `>= 5 min` → Holding

These values are intentionally centralised so they can be changed later.

---

## Flight stability states — display/awareness role

The Thailand sequence uses the known lifecycle:

`Unstable → Stable → Superstable → Frozen`

For the current rebuild, treat these primarily as **status/awareness indicators for ATC**, not as an automatic assumption that the UI must hard-lock edits at Frozen. The AEROTHAI timing thresholds remain the source for when the status changes.

---

## Multi-runway assignment — operational idea versus rebuild choice

Operationally, multi-runway arrival assignment may consider where the aircraft will park, with aircraft normally assigned to a landing runway that is convenient for the destination gate/parking area.

For the IVAO rebuild, exact real-world gate/runway optimisation is **not required for the first version**. Runway assignment can use a project-defined rule and be refined later.

---

## VTBD compact feeder / STAR codes

**Confirmed concept:** VTBD uses the **first letter of the feeder/STAR entry name** as its compact sequence code.

Working display mapping for the rebuild:

- `E` = ENDUU
- `N` = NAKON
- `S` = SABAI
- `s` underlined = SEHNA
- `W` = WEHHA

SABAI and SEHNA both begin with `S`, so they must be visually distinguished. The current project convention is:

- **SABAI:** uppercase `S`
- **SEHNA:** lowercase `s` with underline

Implementation note: store SEHNA as plain lowercase `s` plus an `UNDERLINE` presentation style instead of relying on a Unicode combining underline, so rendering stays consistent across browsers/fonts.

---

## Scope decision — Approach first

The current rebuild is **Approach AMAN only**. Centre-oriented inbound planning columns such as `NFL`, `ETN`, `CFL`, `RFL`, and `LFUNC` are research for a future phase and are not required for the first Approach implementation.
