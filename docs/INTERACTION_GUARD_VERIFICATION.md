# Interaction guard verification

- Open live VTBD traffic and confirm lifecycle colour follows Predicted IAWP, not AUTO/MANUAL target ownership.
- Drag a Stable flight and confirm it stays Stable colour while receiving a manual-target marker.
- Double-click the row and confirm it returns to AUTO without flashing the old shared target first.
- Confirm a Stable flight remains Stable after RETURN TO AUTO unless its Predicted IAWP has actually entered the Superstable window.
- Drag a flight more than 5 minutes earlier than its natural landing prediction and confirm no fixed gain cap is applied; verify runway and sequence separation constraints still cascade correctly.
- Confirm Delay Required double-click still toggles HOLD/NO HOLD and is not intercepted by the row reset guard.
