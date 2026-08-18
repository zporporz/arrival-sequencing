# Foreign TopSky / AMAN Panel Reference

**Baseline:** 2026-08-18  
**Purpose:** use foreign TopSky/ATM references to interpret the Thailand BACC inbound panel without pretending the foreign implementation is identical to Thailand.

The Thailand CWP screenshot shows an inbound panel with columns similar to:

`ACID | NFL | ETN | CFL | RFL | ATYP | LFUNC`

The meanings below are **foreign-reference hypotheses**, not Thailand-confirmed definitions unless separately confirmed by TH-SME/AEROTHAI material.

---

## High-confidence generic meanings

### ACID

**Aircraft Identification / callsign.**

Confidence: **HIGH**.

### ATYP

**Aircraft Type.**

Confidence: **HIGH**.

### CFL

**Cleared Flight Level.**

Confidence: **HIGH**.

This is standard in multiple TopSky/ATM list descriptions.

### RFL

**Requested Flight Level** (or Requested Final Level in some local profiles).

Confidence: **HIGH for requested-level concept; exact wording may vary by installation**.

---

## ETN

Foreign TopSky profile documentation explicitly defines:

**ETN = Estimated Time Over sector entry** / **Estimated Time of Sector Entry**.

Confidence for Thailand interpretation: **HIGH-MEDIUM**.

This fits the Thailand screenshot particularly well because the panel title itself contains `ETN`, suggesting the list is sorted or keyed by estimated sector-entry time.

Implementation hypothesis for IVAO rebuild:

- ETN should probably represent the predicted UTC time the aircraft reaches the relevant inbound sector/TMA/sector-entry boundary used by that panel;
- do not automatically substitute IAWP TTO/ETO unless the selected panel entry point is actually the IAWP.

---

## NFL

SESAR / MUAC-related ATM material uses **NFL** as the **entry flight level / coordinated entry flight level** for the next sector.

A human-factors/ATC description states conceptually that NFL is the coordinated flight level at which an aircraft is expected to enter a sector. SESAR system requirements also use NFL as the flight level at the next sector-entry point.

Confidence for Thailand interpretation: **MEDIUM**.

Best current hypothesis:

**NFL = coordinated/planned Next-sector Entry Flight Level**.

It should not be interpreted as a generic "next altitude" without sector context.

Relationship:

- NFL: level coordinated/planned for sector entry;
- CFL: level currently cleared by ATC;
- RFL: level requested/filed by the flight.

This three-column combination makes operational sense in an inbound-sector list.

---

## LFUNC

Foreign TopSky material uses **LFUNC = Logical Function** and links it to the Sector Indicator/controller responsibility context. TopSky installations maintain an **LFUNC Frequency Plan**, and an Irish ANSP investment document explicitly refers to the `Controlled Flight Plan Lfunc State` as a flight-data-system function.

Confidence for Thailand interpretation: **MEDIUM-HIGH**.

Best current hypothesis:

**LFUNC = the logical ATC function/sector/controller position associated with or responsible for the flight** (for example the relevant logical sector/function rather than merely a radio callsign).

For the IVAO rebuild, this could eventually map to a logical controller/sector label if useful, but it should stay out of production logic until Thailand confirms how BACC populates this column.

---

## Working interpretation of the whole Thailand inbound row

Current foreign-reference reading:

`ACID | NFL | ETN | CFL | RFL | ATYP | LFUNC`

means approximately:

`Callsign | Coordinated entry FL | Estimated sector-entry time | Current cleared FL | Requested FL | Aircraft type | Logical sector/controller function`

This is coherent as an **inbound-to-sector planning list**: it tells the receiving controller who is coming, when they enter, at what coordinated level, what they are currently cleared to, what level they requested, what aircraft type they are, and which logical control function owns/is associated with the flight.

---

## Source notes

Foreign-reference evidence used in project research:

- VATSIM Scandinavia TopSky profile documentation: ETN = Estimated Time Over sector entry; CFL = Cleared Flight Level; RFL = Requested Flight Level; ATYP = Aircraft type; LFUNC = Logical Function (SI).
- VATSIM Germany TopSky list documentation independently describes ETN as Estimated Time of Sector Entry, CFL as Cleared Flight Level, and RFL as Requested Final Level.
- SESAR ATC trajectory-management requirements use NFL as the flight level at the next sector-entry point.
- MUAC-related academic/operational material describes NFL as a coordinated entry flight level.
- Irish Aviation Authority RP3 planning material explicitly mentions `Controlled Flight Plan Lfunc State` as a system functionality.

These sources support the terminology but do **not** prove BACC configured every field identically.
