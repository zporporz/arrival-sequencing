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

Treat this as a live calculated counter.

---

## HLD — Aircraft currently holding

**Confirmed meaning:** `HLD` shows **how many aircraft are currently holding** for the relevant MAESTRO context.

### Holding location

**Confirmed:** the operational holding point is at the **head of the STAR / feeder-entry point**.

For the rebuild, the default AMAN holding-point model is therefore the STAR head / feeder fix. Procedure-specific exceptions can be added later if supplied.

---

## TOT — Total traffic inbound in system

**Confirmed label/meaning:** `TOT` means **Total traffic inbound in system**.

For the IVAO rebuild, the current working interpretation is the total inbound traffic currently connected/known with destination matching the selected airport, including traffic still outside the TMA.

Conceptually:

- `TOT` = all inbound traffic in the AMAN population;
- `TMA` = subset currently inside the TMA;
- `HLD` = subset currently holding.

Exact membership boundaries can be refined later for disconnect, landing, diversion, go-around and filtering by view.

---

## Delay colour thresholds — working confirmed baseline

The Thailand MAESTRO HMI uses:

- Green — Expedite
- White/grey — Nothing
- Yellow — Speed reduction
- Orange — Path Stretching
- Red — Holding

For the current rebuild, the project owner has confirmed the following **working threshold baseline**. These values are intentionally centralised so they can be changed later if a more exact operational table is recalled or supplied.

- `< 0 min` → Expedite
- `0 min` → Nothing
- `1–2 min` → Speed reduction
- `3–4 min` → Path Stretching
- `>= 5 min` → Holding

Do not spread these numeric bands across UI code; reference the central AMAN constants/configuration.
