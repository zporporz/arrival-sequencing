# Flight Status Implementation

Evidence basis: Thailand MAESTRO deck + TH-SME project decisions.

## Automatic status progression

- `UNSTABLE`: more than 15 minutes from the current predicted IAWP / feeder-fix crossing.
- `STABLE`: 15 minutes or less from the current predicted IAWP crossing.
- `SUPERSTABLE`: 5 minutes or less from the current predicted IAWP crossing.
- `FROZEN`: 4 minutes or less from the current predicted landing time. The Thai deck also describes this as approximately 10 NM final.

The status is awareness information for ATC. Prediction continues updating from live traffic data.

## ATC manual target rule

If ATC drags a flight to a manual TLDT, that flight becomes at least `STABLE` immediately even when it is still more than 15 minutes from the IAWP.

The manually selected target is locked:

- TLDT remains at the ATC-selected time.
- TTO remains derived from that target and the configured nominal STAR time.
- Live predicted IAWP ETA continues updating.
- Delay Required is recalculated continuously against the locked target.
- The flight can still progress automatically from Stable to Superstable and Frozen as it gets closer.
- Resetting the row returns it to automatic sequencing.

## Presentation rule

Flight-status colour belongs to the callsign/status presentation. Delay colour remains a separate indication on the delay value / delay-action presentation and must not be conflated with flight status.
