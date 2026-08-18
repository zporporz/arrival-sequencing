# AMAN / MAESTRO Research Baseline

Research baseline for the clean rebuild of the Arrival Sequencing frontend.

**Research date:** 2026-08-18

The purpose of this folder is to keep operational facts, HMI observations, source provenance, and unresolved questions separate from implementation code.

## Evidence labels

- **TH-OFFICIAL** — published by AEROTHAI or CAAT.
- **TH-DECK** — AEROTHAI presentation `Arrival Sequencing Management-Maestro BACC v2.pdf` supplied to the project.
- **TH-SME** — information supplied by a Thailand operational SME through the project owner; useful but not independently published.
- **OBSERVED** — visible in real MAESTRO screenshots supplied to the project, but the exact semantic definition may still be unknown.
- **GENERIC-AMAN** — primary-source EUROCONTROL/SESAR or credible foreign AMAN/MAESTRO/TopSky material used where Thailand-specific material is unavailable.
- **PROJECT-RULE** — project-specific behaviour intentionally chosen for the IVAO rebuild when exact real-world behaviour is unavailable or unsuitable for IVAO.
- **UNKNOWN** — behaviour/label not yet understood well enough to implement safely.

## Source-priority rule

For this rebuild, use the best available operational evidence in this order:

1. Thailand official material / AEROTHAI MAESTRO material.
2. Thailand SME information or clearly readable real Thailand MAESTRO screenshots.
3. Primary/credible foreign AMAN, MAESTRO, SESAR, EUROCONTROL or comparable ATM-system references when Thailand material is absent.
4. A clearly documented project-specific rule when the real system is unknown or when IVAO requires different behaviour.

A foreign-reference behaviour **may be implemented as the working baseline** when no Thailand-specific answer exists and the behaviour is operationally compatible with the Thailand screenshots/workflow. It does not need to remain blocked simply because Thailand documentation is unavailable. Keep provenance noted so it can be replaced later if a Thailand-specific rule is learned.

Do not mix incompatible terminology silently. If a foreign source uses a concept that conflicts with known Thailand behaviour, Thailand evidence wins.

## Documents

- [`THAILAND_MAESTRO_RESEARCH.md`](./THAILAND_MAESTRO_RESEARCH.md) — operational model, Thailand deployment, timing concepts, feeder fixes, sequencing workflow, status model, and verified/non-verified behaviour.
- [`HMI_SETTINGS_CATALOG.md`](./HMI_SETTINGS_CATALOG.md) — inventory of the real Centre AMAN/CWP screen, settings, columns, panels, colour coding, and unresolved abbreviations.
- [`THAI_PRECURSOR_CONTEXT.md`](./THAI_PRECURSOR_CONTEXT.md) — AEROTHAI's earlier Bangkok terminal-sequencing/IAWP target-time work and how it informs the current research without being confused with MAESTRO.
- [`FOREIGN_TOPSKY_PANEL_REFERENCE.md`](./FOREIGN_TOPSKY_PANEL_REFERENCE.md) — foreign ATM/TopSky terminology used to interpret otherwise undocumented fields.
- [`APPROACH_TIMELINE_STATUS_AND_ETA.md`](./APPROACH_TIMELINE_STATUS_AND_ETA.md) — Approach timeline, status lifecycle and IVAO ETA strategy.
- [`LATE_TRAFFIC_INSERTION.md`](./LATE_TRAFFIC_INSERTION.md) — late/spawned inbound insertion and resequencing behaviour.
- [`SOURCE_INDEX.md`](./SOURCE_INDEX.md) — source list and what each source supports.

## Implementation rule

Prefer Thailand behaviour when known. When it is not known, a credible foreign AMAN/ATM reference may define the working behaviour rather than leaving the feature unusable. Mark the source/provenance in research/configuration and keep important thresholds/behaviour centralised so they can be revised later.

## Backend preservation

This research does not replace the existing data/API layer. The clean frontend rebuild is expected to reuse the existing IVAO authentication, `/api/workspaces`, `/api/sequence/*`, route/AIRAC services, Supabase/PostgreSQL data, and server-side IVAO Tracker access where applicable.
