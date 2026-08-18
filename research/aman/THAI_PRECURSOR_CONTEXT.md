# Thailand Arrival-Sequencing Precursor / ATFM Context

**Research date:** 2026-08-18

This file records Thailand-specific public material that predates the current MAESTRO deployment and helps explain how arrival sequencing evolved. It should not be treated as proof that the current MAESTRO uses the same algorithms or fields.

## AEROTHAI Air Traffic Flow Management Platform (2017)

Official AEROTHAI source:

- https://www.aerothai.co.th/en/awards/air-traffic-flow-management-platform-2017

AEROTHAI described an ATFM platform capable of:

- strategic demand prediction from schedule/slot/historical flight data;
- pre-tactical/tactical demand monitoring;
- ATFM-measure planning and CTOT calculation/publication;
- real-time updates with surveillance data;
- what-if ATFM scenarios;
- APIs allowing specialised tools to be built on top of the platform.

Most relevant to the AMAN project, AEROTHAI stated that a tool was developed to reduce airborne holding around Bangkok TMA by calculating **Target Take-Off Time** and **Estimated Time of Arrival at fixes along the filed flight path until the Initial Approach Way Point for domestic flights**. It also states that a **Bangkok Terminal Sequencing Tool** and **Intelligent Departure Manager** were included to assist traffic-flow management for Suvarnabhumi and Don Mueang.

## Why this matters

This is useful evidence that Thailand had already developed a target-time / IAWP-based sequencing concept before the 2025 MAESTRO material now held by the project. It reinforces several design choices:

- IAWP is an operationally meaningful boundary for terminal sequencing;
- target-time guidance and ETA-to-fix prediction are not arbitrary concepts invented for the web project;
- real-time surveillance updates are relevant to tactical arrival prediction;
- arrival/departure flow tools are naturally integrated with a broader ATFM data platform.

## Limitations

Do not assume the 2017 Bangkok Terminal Sequencing Tool and the 2025+ MAESTRO installation are the same software or use identical field names/settings. The source is historical context only.
