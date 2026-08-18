# Thailand MAESTRO — SME Confirmed Settings

**Baseline:** 2026-08-18  
**Evidence:** TH-SME — operational information supplied directly through the project owner.

This file records Thailand-specific MAESTRO meanings that have been confirmed by an operational SME but are not yet supported by a published manual available to the project.

---

## ΔT — Average Delay

**Confirmed meaning:** `ΔT` is the **average delay of the aircraft in the arrival sequence / STAR flow**.

It represents, at a glance, how many minutes of delay aircraft are being required to absorb on average before meeting the MAESTRO target.

Conceptually:

`ΔT = sum of aircraft Delay Required values / number of aircraft included`

Example:

- Aircraft A delay required = 2 min
- Aircraft B delay required = 4 min
- Aircraft C delay required = 6 min

Then:

`ΔT = (2 + 4 + 6) / 3 = 4 min`

### Relationship to the main sequence row

The main MAESTRO row already contains an individual **Delay Required** value for each aircraft. `ΔT` is not another target time; it is an aggregate/summary indicator derived from those per-aircraft delay values.

### Implementation note

For the rebuild, `ΔT` should be treated as a calculated dashboard/stream metric rather than a manually entered setting.

Still to confirm before hard-coding the exact calculation scope:

- whether aircraft requiring time gain / Expedite (negative delay) are included as signed values;
- whether only positive delay is included;
- whether the average is calculated per airport, runway, STAR/IAWP stream, selected sector/view, or another active-filter scope;
- whether Frozen/landed/holding aircraft are included or excluded.

Until those scope rules are confirmed, the semantic definition above is authoritative but the exact population/filter used in the average remains configurable/TODO.

---

## TMA — Aircraft currently inside the TMA

**Confirmed meaning:** the `TMA` counter shows **how many aircraft are currently inside the TMA** for the relevant MAESTRO view/context.

### Implementation note

Treat this as a live calculated counter, not a manually entered setting.

Still to confirm:

- the exact TMA volume/filter represented by each controller/view;
- whether the count includes all controlled arrivals or only flights participating in the active AMAN sequence;
- how boundary transitions are handled at the exact entry/exit instant.

---

## HLD — Aircraft currently holding

**Confirmed meaning:** the `HLD` counter shows **how many aircraft are currently in holding** for the relevant MAESTRO view/context.

### Implementation note

Treat this as a live calculated counter. It should be derived from operational flight/holding state rather than entered manually.

Still to confirm:

- whether only published holding fixes associated with the active arrival flow are counted;
- whether multiple holds/holding areas are aggregated into one total;
- how an aircraft is classified during hold entry/exit transitions.

---

## TOT — Meaning not yet recalled/confirmed

`TOT` is visible in the real Thailand MAESTRO HMI, but its exact meaning has **not yet been re-confirmed by the SME**.

Do not infer or hard-code a meaning from generic ATM terminology. Keep `TOT` marked **UNKNOWN** until confirmed.
