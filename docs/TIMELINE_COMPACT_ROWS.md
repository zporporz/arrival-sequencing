# Compact True-Time Timeline Rows

The timeline now prioritizes **time truth** over displaced callout packing.

- Every aircraft row stays exactly on its real STA/TLDT time anchor (`--offset-px`).
- No packed offset or leader line is used.
- Rows are reduced to approximately 18 px on desktop and remain single-line.
- TDLY, EDLY/ADLY, MAESTRO matrix cue and LEAVE/GS advisory are rendered horizontally inside the same compact delay cell.
- LEFT and RIGHT airport placement remains unchanged.
- Hover/drag raises the selected row above nearby traffic without changing its time position.
- Extremely close targets may visually touch, but they are never moved away from their actual timeline time.

Verification:

1. TEST TRAFFIC with VTBD only: rows must stay on their timeline times and be substantially smaller than the previous card layout.
2. TEST TRAFFIC with VTBD + VTBS: both sides must stay aligned to their own true time anchors with no leader lines.
3. Drag a flight: the row should move directly with the target time.
4. Double-click: the row returns directly to the AUTO time.
5. HLD traffic: `LEAVE HH:MM` remains visible inline rather than creating a second row of height.
