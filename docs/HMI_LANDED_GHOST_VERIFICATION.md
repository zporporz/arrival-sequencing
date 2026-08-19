# HMI / landed ghost verification

- Holding advisory `LEAVE HH:MM` is readable at normal desktop scale.
- Callsign, TLDT, TTO, IAWP, delay and runway values remain readable without changing timeline height.
- Inbound MON/LATE badges and INSERT action are readable.
- A disconnected en-route/approach flight is retained as GHOST for reconnect recovery.
- A flight whose last IVAO sample is terminal/on-ground is released instead of becoming GHOST.
- A flight very close to VTBD/VTBS with rollout/taxi-like groundspeed (<=90 kt within 3.5 NM) is released when it disconnects even if IVAO did not publish a final LANDED state.
- Short-final traffic remains protected because normal final approach speed is above the landed-release groundspeed gate.
