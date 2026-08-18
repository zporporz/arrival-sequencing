# Approach AMAN — Late Inbound / Spawn Insertion Handling

**Baseline:** 2026-08-18  
**Scope:** IVAO Approach AMAN rebuild.  
**Evidence:** project-owner operational design based on Thailand MAESTRO workflow and IVAO-specific traffic behaviour.

---

## Problem

IVAO traffic can appear late in the AMAN picture:

- an international flight may first become visible only after entering the useful planning horizon;
- a pilot may connect/spawn already airborne near Bangkok;
- a nearby flight can file/connect with destination VTBS/VTBD after an existing sequence has already been built.

The newly acquired aircraft can therefore have a predicted arrival time that falls between two aircraft already sequenced. The system must not ignore it or simply append it to the end.

---

## Initial treatment of a late-acquired flight

When a new inbound is first detected:

1. mark it **Unstable** immediately;
2. calculate the best available live predicted IAWP/landing time using the current ETA-source priority;
3. find where its predicted TLDT would naturally fall in the active runway sequence;
4. compare the new aircraft against the aircraft immediately before and after it using the active configured separation/gap rules;
5. if sufficient spacing already exists, insert it without disturbing later traffic;
6. if spacing is insufficient, create a resequencing conflict and calculate the minimum time displacement required.

Use full time precision internally (seconds/milliseconds) when ordering predicted arrivals. Displayed AMAN times may remain minute-oriented, but two aircraft predicted within the same displayed minute still need a deterministic ordering.

---

## Cascading displacement / reflow

If the late aircraft must be inserted between existing aircraft, recompute the affected downstream chain.

Conceptually:

`new TLDT of affected follower = max(previous target, predecessor TLDT + required separation)`

The required separation comes from the active runway spacing / aircraft-specific separation configuration.

If moving one follower later creates a conflict with the next aircraft, continue the reflow forward until all affected pairs satisfy separation.

Do **not** move aircraft earlier automatically merely to compensate for the insertion. Late acquisition should primarily push conflicting downstream targets later unless ATC explicitly chooses another sequence/runway solution.

---

## ATC warning / awareness

A late insertion that changes an existing target sequence should be obvious to the controller.

Recommended Approach HMI behaviour:

- highlight the newly acquired aircraft as **NEW / UNSTABLE**;
- highlight every aircraft whose target had to move because of the insertion;
- show the amount of additional target delay created, e.g. `+02:14`, `+03:00`, etc.;
- show a compact alert such as **LATE TRAFFIC — RESEQUENCE REQUIRED** or **NEW INBOUND INSERTED**;
- keep the alert until the controller acknowledges/accepts the updated sequence or manually changes it.

The `+time` shown to ATC should be derived from the applicable separation setting, not a fixed arbitrary warning value.

---

## Status behaviour for displaced aircraft

Project working rule:

- the newly acquired flight is **Unstable**;
- an aircraft whose target position is changed by the late insertion should be treated as **sequence-unstable / resequence required** until the new target is accepted;
- once ATC accepts or manually places the new sequence, normal Stable/Superstable/Frozen awareness can resume based on the Approach status model.

This is an IVAO project behaviour for handling late data acquisition. It should be kept logically separate from the published AEROTHAI time/distance definitions of Unstable/Stable/Superstable/Frozen so the UI can distinguish **planning-status lifecycle** from **a new resequencing disturbance** if necessary.

---

## Example

Existing target sequence on one runway:

- A — TLDT 10:20:00
- B — TLDT 10:22:34
- C — TLDT 10:25:08

Assume active separation is 6 NM at the 140 kt planning reference, approximately 2 min 34 sec.

A newly connected inbound X is predicted naturally at 10:21:10, between A and B.

Required result:

- A remains 10:20:00
- X cannot be placed 10:21:10 because it is too close behind A; earliest feasible slot becomes about 10:22:34
- B is then too close behind X and is pushed to about 10:25:08
- C may also need to move if B now conflicts with C

The system should show X as new/Unstable and explicitly warn ATC that B/C were displaced, including the amount each target moved.

---

## Design principle

The key distinction is:

- **prediction** answers: "when will this newly seen aircraft actually reach the sequence?"
- **sequence insertion** answers: "where can it legally fit given the active gap?"
- **reflow** answers: "which existing aircraft must move later because of the insertion?"
- **warning** tells ATC that the plan changed unexpectedly.

Do not silently alter an already-built sequence without a visible ATC indication.