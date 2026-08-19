# AMAN four-core verification

This checklist covers the first integrated implementation of the four major Approach AMAN blocks.

## Shared target persistence / realtime

- Drag a flight in browser A and verify TLDT moves in browser B.
- Assign a landing runway in browser A and verify browser B follows.
- Double-click the row to return it to AUTO and verify browser B follows.
- Refresh both browsers and verify manual TLDT/runway remains.
- Change runway configuration and LAND SEP; verify all connected controllers receive it.

## Holding / Time to Leave Holding Fix

- Create a delay of at least 5 minutes.
- Verify HLD counter increments.
- Verify the row shows `LEAVE HH:MM` using TTO at the STAR entry/IAWP.
- Double-click the Delay Required number to toggle shared HOLD/NO HOLD override.

## Speed advisory

- Create a Speed Reduction or Expedite condition.
- Verify a planning groundspeed advisory appears as `GS~xxx`.
- Verify an infeasible speed-only solution displays `SPD+PATH`.

## Shared reconnect recovery

- Disconnect a pilot and verify the slot becomes GHOST without disappearing.
- Reconnect within 30 minutes and verify the same canonical slot/TLDT/runway is retained.
- Verify plausible movement shows RECONNECTED.
- Verify an implausible position jump produces POSITION JUMP warning.
- Verify all controllers see the same reconnect/ghost state.

## Failure handling

- Shared-state failure must not prevent live IVAO traffic from loading.
- System drawer should show Shared AMAN error state when persistence/realtime is unavailable.
