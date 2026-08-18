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
