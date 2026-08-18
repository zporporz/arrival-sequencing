# AMAN / MAESTRO Research Baseline

Research baseline for the clean rebuild of the Arrival Sequencing frontend.

**Research date:** 2026-08-18

The purpose of this folder is to keep operational facts, HMI observations, source provenance, and unresolved questions separate from implementation code. The frontend must not invent MAESTRO behaviour where the evidence is incomplete.

## Evidence labels

- **TH-OFFICIAL** — published by AEROTHAI or CAAT.
- **TH-DECK** — AEROTHAI presentation `Arrival Sequencing Management-Maestro BACC v2.pdf` supplied to the project.
- **TH-SME** — information supplied by a Thailand operational SME through the project owner; useful but not independently published.
- **OBSERVED** — visible in real MAESTRO screenshots supplied to the project, but the exact semantic definition may still be unknown.
- **GENERIC-AMAN** — primary-source EUROCONTROL/SESAR material describing AMAN concepts; useful for filling architecture gaps but not proof that Thailand configured MAESTRO identically.
- **UNKNOWN** — observed label/behaviour that must not be guessed.

## Documents

- [`THAILAND_MAESTRO_RESEARCH.md`](./THAILAND_MAESTRO_RESEARCH.md) — operational model, Thailand deployment, timing concepts, feeder fixes, sequencing workflow, status model, and verified/non-verified behaviour.
- [`HMI_SETTINGS_CATALOG.md`](./HMI_SETTINGS_CATALOG.md) — inventory of the real Centre AMAN/CWP screen, settings, columns, panels, colour coding, and unresolved abbreviations.
- [`SOURCE_INDEX.md`](./SOURCE_INDEX.md) — source list and what each source supports.

## Implementation rule

Before implementing a MAESTRO-like field or control, check its evidence label in this folder. Items marked **UNKNOWN** should stay out of production logic or be exposed only as clearly provisional configuration until a Thailand source/SME confirms them.

## Backend preservation

This research does not replace the existing data/API layer. The clean frontend rebuild is expected to reuse the existing IVAO authentication, `/api/workspaces`, `/api/sequence/*`, route/AIRAC services, Supabase/PostgreSQL data, and server-side IVAO Tracker access where applicable.
