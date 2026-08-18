# AMAN / MAESTRO Source Index

**Research date:** 2026-08-18

This index records what each source is allowed to support. It exists to prevent future implementation from accidentally treating assumptions or generated mockups as real MAESTRO behaviour.

---

## A. Thailand primary / project-held sources

### A1. AEROTHAI — `Arrival Sequencing Management-Maestro BACC v2.pdf`

**Provenance:** supplied to the project; AEROTHAI presentation for Airspace Users–ANSP Meeting, 20 August 2025.  
**Confidence:** TH-DECK / strongest current source for Thailand MAESTRO HMI and operating concept.

Supports:

- title: Arrival Sequencing Management at Bangkok Area Control Centre (MAESTRO);
- VTBS/VTBD stated in operation May 2025;
- AMAN-to-AMAN Coordination;
- VTBS 3-runway operation capability;
- Time to Lose / Time to Gain at Feeder Fixes;
- Speed Advisory;
- Time to Leave Holding Fixes when necessary;
- photo of dedicated Centre AMAN Position;
- screenshot/photo of MAESTRO at BACC Controller Working Position;
- exact Flight Status categories and transition timing/range;
- 2025 deployment plan for VTSP;
- 2025 future-deployment statement for VTCC/VTSS/VTSM.

Must **not** be used as proof that the 2025 future rollout dates were actually achieved. Current deployment status needs a newer source.

---

### A2. Bangkok ATFMU Users Manual Rev.3, effective 30 October 2025

**Provenance:** supplied to project.  
**Confidence:** TH-OFFICIAL for Bangkok ATFM terminology, not a MAESTRO HMI manual.

Supports definitions of:

- ETO — Estimated Time Over;
- CTO — Calculated Time Over;
- ELDT — Estimated Landing Time;
- CLDT — Calculated Landing Time;
- ALDT — Actual Landing Time;
- CTOT and other ATFM event times;
- ATFM/GDP concepts.

Important restriction: this manual does **not** establish that MAESTRO TLDT/TTO should be renamed CLDT/CTO. Keep AMAN target terminology separate unless a direct Thailand source maps them.

---

### A3. ICAO Doc 4444 copy in project library

Supports general ATC arrival-sequence/separation principles, including the fact that the interval between successive approaches is affected by relative speed, distance to runway, wake turbulence, runway occupancy, meteorological conditions and local instructions.

Use this to avoid oversimplifying spacing into one global fixed number. It is not a MAESTRO configuration manual.

---

## B. Thailand official web sources

### B1. AEROTHAI — infrastructure / aviation-hub articles

Primary AEROTHAI pages publicly state that **Arrival Manager (AMAN)** is used to manage inbound traffic and **iDEP** manages outbound traffic.

Sources:

- https://www.aerothai.co.th/th/news-event/news/10191
- https://www.aerothai.co.th/th/node/11330

Supports:

- AMAN is an AEROTHAI operational technology for inbound management;
- AMAN is part of wider flow/capacity improvement work;
- iDEP is the paired departure-management technology at concept level.

Does not document detailed MAESTRO screen fields/settings.

---

### B2. AEROTHAI — iDEP Chiang Mai/Phuket 2026

Source:

- https://www.aerothai.co.th/th/news-event/news/13256

Supports:

- iDEP operational at Chiang Mai and Phuket from 19 February 2026;
- real-time data integration / A-CDM context.

Does **not** prove that AMAN became operational at VTSP. Keep VTSP AMAN status unconfirmed until a direct source is found.

---

### B3. CAAT eAIP — current publication status

Current eAIP package found during research:

- https://aip.caat.or.th/2026-08-06-AIRAC/html/VT-cover-en-GB.html

Effective 06 August 2026, AIRAC AIP AMDT 08/26.

Use current eAIP/NOTAM whenever implementing operational route/procedure data.

---

### B4. CAAT ENR 1.10 — VTBD/VTBS flight-planning/IAWP rules

Latest fully indexed detailed page available during this research:

- https://aip.caat.or.th/2026-07-09-AIRAC/html/eAIP/VT-ENR-1.10-en-GB.html

The current package is 06 Aug 2026, but search indexing did not expose the Aug ENR 1.10 text directly. Re-check before operational release.

Supports route → IAWP planning logic, including important examples such as:

- VTBD: `... Y99 HOTEL DCT SABAI`
- VTBS: south/southwest arrival families to LEBIM
- north arrivals to NAKON/NORTA
- east/northeast families to ENDUU/EASTE
- southeast families to SEHNA/TUMGA
- west/northwest families to WEHHA/WILLA

---

### B5. CAAT aerodrome STAR pages

Useful indexed sources:

- VTBD: https://aip.caat.or.th/2026-07-09-AIRAC/html/eAIP/VT-AD-2.VTBD-en-GB.html
- VTBS indexed 2026 source: https://aip.caat.or.th/2026-05-14-AIRAC/html/eAIP/VT-AD-2.VTBS-en-GB.html

Supports published STAR families and runway applicability.

Before implementation/deployment, refresh from the currently effective AIRAC rather than treating this research snapshot as static navigation data.

---

## C. Generic AMAN primary sources

These explain AMAN architecture but are **not proof of Thailand MAESTRO configuration**.

### C1. EUROCONTROL PHARE Arrival Management

- https://www.eurocontrol.int/phare/public/standard_page/Arrival_Mgt.html

Supports generic AMAN capabilities:

- automatic optimal sequence;
- scheduled arrival times and landing runways;
- configurable planning horizon;
- recalculation when flight data changes;
- controller manual edits to time/runway;
- maximum landing-flow-rate adjustment;
- runway-slot reservation;
- automatic stack/holding support when speed control cannot absorb enough delay;
- what-if sequence generation.

---

### C2. EUROCONTROL PHARE operational concept / tools

- https://www.eurocontrol.int/phare/public/standard_page/PD2_OC.html
- https://www.eurocontrol.int/phare/public/standard_page/PATs.html

Supports:

- AMAN as ground planning/trajectory support;
- controller advisories for meeting arrival constraints;
- deviations/conflicts still requiring controller involvement;
- sequencing and runway-load-balancing concept.

---

### C3. SESAR Extended AMAN

- https://www.sesarju.eu/sesar-solutions/extended-arrival-management-aman-horizon

Supports generic extended-horizon principles:

- pre-sequence traffic farther upstream;
- give upstream controllers advisories early;
- absorb delay through speed adjustment before low-level holding;
- reduce fuel/noise/holding.

---

### C4. SESAR AMAN/DMAN integration / TLDT terminology

- https://www.sesarju.eu/node/2239
- https://www.sesarju.eu/node/2205

Supports generic use of **Target Landing Time (TLDT)** in integrated arrival/departure management and target-based runway sequencing.

It does not by itself prove the exact Thailand MAESTRO field implementation; the Thailand row meaning is additionally supported by project SME/screenshot evidence.

---

## D. Thailand SME / screenshot evidence

### D1. Real MAESTRO timeline screenshot supplied by project owner

Supports observed main row order:

`TLDT | Callsign | Type | STAR/IAWP | TTO | Time Delay Required | Runway`

### D2. SME explanation supplied through project owner

Supports:

- VTBS compact feeder codes: E=EASTE, T=TUMGA, L=LEBIM, N=NORTA, W=WILLA;
- Delay Required means time that needs to be added/absorbed to meet the target, rather than another ETA field.

### D3. Delay Colour Coding screenshot

Supports action labels:

- Expedite
- Nothing
- Speed reduction
- Path Stretching
- Holding

Does **not** provide trustworthy numeric thresholds in the material currently held.

---

## E. Sources explicitly NOT authoritative for implementation

### Generated mockups

Files such as `image-gen-1.png` / `image-gen-1(1).png` in the project File Library are concept art generated during earlier discussion. They are **not MAESTRO evidence** and must never be used to infer real fields/settings.

### Secondary/community documents

Search results from VATSIM forums/docs, Scribd mirrors, screenshots reposted without provenance, etc. may be used only as leads for terminology. Any behaviour derived from them must remain `UNKNOWN` until confirmed by AEROTHAI/CAAT/official vendor material or Thailand SME evidence.

---

## F. Research refresh checklist

Before implementing a setting that affects operational sequence logic:

1. Check the currently effective CAAT AIRAC and NOTAM.
2. Check for newer AEROTHAI AMAN/MAESTRO material.
3. Prefer the AEROTHAI deck for Thailand-specific status/HMI claims.
4. Ask SME for fields that are visible but undocumented.
5. Record the answer here with date/source.
6. Only then move an item from `UNKNOWN` to verified configuration.
