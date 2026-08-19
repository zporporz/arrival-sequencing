# MAESTRO v2.4 Knowgood Verification

Verify after deployment:

- Destination traffic outside 300 NM remains Inbound/MON and does not enter active sequence.
- Crossing the 300 NM outer processing boundary admits traffic to sequence unless late-insert protection is triggered.
- ETA-FF / live traffic refreshes every 15 seconds.
- Delay display shows TDLY plus EDLY/ADLY split.
- TDLY 6/7/8/9+ shows the source-backed quick-reference bands.
- TDLY 8 highlights runway change as a secondary action; TDLY 9+ shows HOLD ALL / overload.
- VTBS AAR display never claims more than the source-backed ARR 37 MAX.
- AUTO runway allocation uses the earliest feasible active arrival runway and preserves pairwise spacing.
- Right-click live flight: Missed Approach removes from active sequence and provides REINSERT in Inbound.
- Right-click live flight: Desequence removes from active sequence and provides REINSERT.
- Right-click live flight: Insert Gap +1/+2 min cascades following targets and is shared.
- Right-click live flight: Remove excludes from active sequence and provides REINSERT while still connected.
- Runway selector remains the Change runway control.
- ARR/DEP/MIX/CLOSED remains the runway-closure/configuration control.
- Flight lifecycle colours still progress Unstable → Stable → Superstable → Frozen automatically.
- Double-click target still returns the flight to AUTO target.
- Ghost/reconnect and landed-release behaviour still works.
- Shared state remains synchronized across two browsers/controllers.
