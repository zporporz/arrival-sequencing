# Approach AMAN — Late Inbound / Spawn Insertion Handling

**Baseline:** 2026-08-18  
**Scope:** IVAO Approach AMAN rebuild.  
**Evidence:** project-owner operational design based on Thailand MAESTRO workflow and IVAO-specific traffic behaviour, with generic SESAR AMAN stability-model support.

---

## Problem

IVAO traffic can appear late in the AMAN picture:

- an international flight may first become visible only after entering the useful planning horizon;
- a pilot may connect/spawn already airborne near Bangkok;
- a nearby flight can file/connect with destination VTBS/VTBD after an existing sequence has already been built.

The newly acquired aircraft can therefore have a predicted arrival time that falls between two aircraft already sequenced. The system must not ignore it or simply append it to the end.

---

## Automation model — current best interpretation

The project owner recalls that **Unstable traffic is probably arranged by the system first, with ATC then confirming/adjusting the result**.

This is strongly consistent with generic SESAR AMAN baseline requirements, which describe the stability model as:

- **Unstable** — arrival sequence managed by the system;
- **Stable** — sequence management shared by the system and controllers; controller commands adjust the sequence;
- **Frozen** — sequence managed by controllers.

Thailand additionally uses the published **Superstable** intermediate state.

### Project rule for the rebuild

Until a Thailand-specific MAESTRO manual confirms the exact automation boundary, implement the following behaviour:

1. **Unstable aircraft are automatically sequenced by the system.**
2. The system may automatically move/reflow other **Unstable** aircraft to satisfy the configured separation.
3. Once an aircraft is already Stable/Superstable/Frozen, do **not silently move it** because a late IVAO aircraft appeared.
4. If inserting a new Unstable aircraft would require moving a Stable/Superstable/Frozen target, calculate the proposed resequence and present it to ATC as a visible **confirmation-required change**.
5. ATC may accept the proposed shift or manually drag/resequence the affected flight(s).

This gives IVAO the benefit of automatic planning while avoiding surprise changes to an already established Approach plan.

---

## Initial treatment of a late-acquired flight

When a new inbound is first detected:

1. mark it **Unstable** immediately;
2. calculate the best available live predicted IAWP/landing time using the current ETA-source priority;
3. find where its predicted TLDT would naturally fall in the active runway sequence;
4. compare the new aircraft against the aircraft immediately before and after it using the active configured separation/gap rules;
5. automatically place it in the earliest feasible slot;
6. if the affected downstream aircraft are still Unstable, automatically reflow those Unstable targets;
7. if the required reflow reaches Stable/Superstable/Frozen traffic, stop automatic propagation at that boundary and raise an ATC confirmation/resequence alert.

Use full time precision internally (seconds/milliseconds) when ordering predicted arrivals. Displayed AMAN times may remain minute-oriented, but two aircraft predicted within the same displayed minute still need a deterministic ordering.

---

## Cascading displacement / reflow

For aircraft the automation is allowed to move, recompute the affected downstream chain.

Conceptually:

`new TLDT of affected follower = max(previous target, predecessor TLDT + required separation)`

The required separation comes from the active runway spacing / aircraft-specific separation configuration.

If moving one Unstable follower later creates a conflict with the next Unstable aircraft, continue the reflow forward until all affected pairs satisfy separation or until the chain reaches an aircraft whose established status should require ATC confirmation.

Do **not** move aircraft earlier automatically merely to compensate for the insertion. Late acquisition should primarily push conflicting downstream targets later unless ATC explicitly chooses another sequence/runway solution.

---

## ATC warning / confirmation

A late insertion that changes or attempts to change an established target sequence should be obvious to the controller.

Recommended Approach HMI behaviour:

- highlight the newly acquired aircraft as **NEW / UNSTABLE**;
- show the automatic slot chosen for it;
- highlight every Unstable aircraft automatically displaced by the insertion;
- show the amount of additional target delay created, e.g. `+02:14`, `+03:00`, etc.;
- if the reflow reaches Stable/Superstable/Frozen traffic, show a compact alert such as **NEW INBOUND — ATC CONFIRM RESEQUENCE**;
- preview the proposed new TLDT(s) before applying changes to established traffic;
- keep the alert until ATC accepts or manually resolves the sequence.

The `+time` shown to ATC should be derived from the applicable separation setting, not a fixed arbitrary warning value.

---

## Status behaviour

Working project interpretation:

- newly acquired flight = **Unstable**;
- Unstable traffic is system-managed and may be automatically rearranged;
- Stable traffic represents a more established plan where system and ATC share management;
- Superstable is an even more mature Thailand planning state;
- Frozen is treated primarily as the final awareness state and should not be automatically displaced by late-arriving IVAO data without ATC action.

Keep the published Thailand timing/distance definitions of Unstable/Stable/Superstable/Frozen separate from any extra UI flag such as **RESEQUENCE REQUIRED**.

---

## Example

Existing target sequence on one runway:

- A — Stable — TLDT 10:20:00
- B — Unstable — TLDT 10:22:34
- C — Unstable — TLDT 10:25:08

Assume active separation is 6 NM at the 140 kt planning reference, approximately 2 min 34 sec.

A newly connected inbound X is predicted naturally at 10:21:10.

The system should:

- keep A at 10:20:00 because it is already Stable;
- place X at the earliest feasible target behind A, about 10:22:34;
- automatically push B to about 10:25:08 because B is still Unstable;
- continue pushing C if required;
- warn ATC that a new inbound was inserted and show the added delay to B/C.

If B were already Stable, the system should instead propose the new arrangement and require ATC confirmation rather than silently moving B.

---

## Design principle

The key distinction is:

- **prediction** answers: "when will this newly seen aircraft actually reach the sequence?"
- **automatic Unstable sequencing** answers: "where can the system place it while it is still planning?"
- **reflow** answers: "which still-Unstable aircraft can move later automatically?"
- **ATC confirmation boundary** answers: "when would the automation disturb an already established plan?"
- **warning** tells ATC that the plan changed unexpectedly or needs approval.

This model should remain labelled as the project's best current interpretation until Thailand-specific MAESTRO automation behaviour is explicitly confirmed.