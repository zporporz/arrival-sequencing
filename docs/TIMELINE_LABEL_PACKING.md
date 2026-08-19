# Timeline Label Packing

Busy arrival banks can have target times only 2–4 minutes apart while readable HMI labels are taller than the corresponding 20–40 px time spacing. The timeline therefore separates **time truth** from **label placement**:

- `--offset-px` remains the true STA/TLDT time anchor.
- `--packed-offset-px` is presentation only and is allowed to move enough to avoid visual overlap.
- A leader line/diamond points from a packed label back to its true time anchor.
- LEFT and RIGHT timeline sides are packed independently.
- Ordering is preserved.
- Runway spacing, TLDT/TTO, cascade sequencing and delay calculations are never modified by label packing.
- 11+ labels on one side enable dense mode; 18+ enable ultra-dense mode.
- Packing is recalculated after React row/style changes, airport-side changes and browser resize.

Verification:

1. TEST TRAFFIC: all 8 labels must remain individually readable without covering adjacent callsigns/advisories.
2. Drag a packed row: its target changes normally and packing follows the new anchor.
3. Double-click RETURN AUTO: the target returns to AUTO and the label repacks without changing sequence truth.
4. Select VTBD + VTBS on opposite sides: packing must operate independently on each side.
5. Heavy synthetic/live traffic: no DOM flicker or rapid left/right side jumping.
