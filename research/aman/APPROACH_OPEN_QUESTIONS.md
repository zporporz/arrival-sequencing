# Approach AMAN — Remaining Open Questions

**Baseline:** 2026-08-18

Current scope is **Approach only**. Centre-oriented TopSky/flight-data panels are deferred.

## Operational questions still worth confirming

### 1. `Earliest`

Still unknown. Need to confirm what the `Earliest` control/indicator means in Thailand MAESTRO and whether it changes sequence generation, shows an earliest-achievable time, or performs another planning function.

### 2. Special separation pairwise logic

Known baseline values exist for normal runway spacing, ATR separation and A380 separation, but the exact rule for combining them is still unknown.

Need to confirm cases such as:

- ATR leading / following another type;
- A380 leading / following another type;
- whether the larger of runway-spacing and aircraft-specific separation is used;
- whether wake category and runway dependency add further rules.

### 3. Controller manual sequence interaction

For a future interactive version, still need to know what Approach controllers can manually alter in the real HMI:

- reorder/swap aircraft;
- change runway;
- change target time;
- insert a gap/slot;
- lock/force a sequence position.

This is not required for the first display-first MVP.

## Closed / confirmed

### `ΔT`

Confirmed: `ΔT` is calculated per runway/sequence box directly from the signed Delay Required values displayed for the aircraft in that runway sequence.

`ΔT = sum(delay values) / number of aircraft`

Negative Expedite values are part of the arithmetic average; if the sequence has no net delay, ΔT can be zero or negative depending on the displayed delay values.

## Product/technical decisions — do not require Thailand SME answers now

### HLD state in IVAO

Real MAESTRO shows holding status and expected leave-hold timing, but IVAO does not expose a definitive ATC HOLD instruction state. Choose later between manual marking, track-pattern inference, or hybrid logic.

### Multi-runway assignment in the rebuild

Real-world assignment can consider parking/gate convenience. For the IVAO project, use a project-defined runway assignment rule first and refine later.

### TMA counter implementation

Use the working Bangkok definition of **within 50 NM of BKK VOR**. This is technically implementable from IVAO latitude/longitude once the BKK VOR reference coordinate is fixed in configuration.

### Special cases

Go-around, emergency/priority handling, diversion, and runway-change behaviour can be designed by the project later if exact MAESTRO behaviour is unavailable.
