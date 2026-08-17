# Bangkok FIR Arrival Sequencing

Shared realtime arrival-sequencing workspace for IVAO Thailand / Bangkok FIR controllers.

**Production:** https://atc-sequence.pages.dev  
**Repository:** `zporporz/arrival-sequencing`

> This project is a training/prototype sequencing tool. Timing warnings and planning estimates are decision-support aids, not a substitute for applicable ATC procedures, separation minima, local instructions, or controller judgement.

---

## What it does

The application provides a shared arrival board where connected controllers can build and adjust a landing sequence in realtime. It combines controller-entered planning data, configured reference-fix timings, IVAO live traffic, filed routes, and live aircraft position / groundspeed to help estimate and coordinate arrival times.

Core timing flow:

```text
ETO at REF FIX
     ↓ + nominal fix-to-runway time
ELDT
     ↓ controller sequencing / TLDT override
TLDT
     ↓ - nominal fix-to-runway time
CTO at REF FIX
     ↓
ALDT + variance after landing
```

---

# Features

## 1. IVAO authentication

- Sign in with IVAO SSO.
- Authenticated user profile is loaded from IVAO.
- Displays controller name, VID, IVAO / Thailand Division role and staff positions.
- Thailand Division staff are automatically recognized and given access to the Staff Admin Console.
- Signed server session is stored in an HMAC-signed `HttpOnly` / `SameSite` cookie.
- Sign-out support.

## 2. Shared realtime sequencing workspace

- Multiple controllers can use the same sequence simultaneously.
- Realtime INSERT / UPDATE / DELETE synchronization through Supabase Realtime.
- Presence channel shows controllers currently online in the selected workspace.
- Controller presence includes display name, VID, role and Thailand staff codes where available.
- Live edit presence shows when another controller is editing a field.
- Edit presence is focus-scoped: moving to another field or leaving a field clears the previous editor badge, with one active cell tracked per controller.
- Changes autosave and appear on connected screens.
- UTC clock and realtime connection indicator in the header.

## 3. Multi-airport / multi-runway workspace core

- Live workspaces are loaded dynamically from Published airport and runway master data.
- Workspace selection supports:
  - airport;
  - flow;
  - runway configuration.
- URL state uses:

```text
?airport=<ICAO>&flow=<FLOW>&runway=<LABEL>
```

- Session lookup / creation follows the selected airport + flow + UTC service date.
- Realtime channels are scoped to the selected sequence session.
- Reference-fix timing lookup follows the selected session airport and flow.
- Airport and runway tabs are rendered from master data rather than hard-coded VTBD logic.
- Add Flight is disabled when a Published workspace does not have Timing Active or has no active timing records.
- Timing Pending / Timing Disabled workspaces show a warning instead of silently using guessed data.

## 4. Arrival sequence board

Each flight row contains:

| Field | Meaning |
|---|---|
| `SEQ` | Sequence number |
| `CALLSIGN` | Aircraft callsign |
| `A/C` | Aircraft type |
| `DEP` | Departure aerodrome |
| `REF FIX` | Reference fix used for timing |
| `ETO` | Estimated Time Over the reference fix |
| `ELDT` | Estimated Landing Time |
| `TLDT` | Target Landing Time |
| `CTO` | Calculated Time Over the reference fix |
| `ALDT` | Actual Landing Time |
| `EST VAR` | `ALDT - ELDT` |
| `SEQ VAR` | `ALDT - TLDT` |
| `STATUS` | Current flight lifecycle state |

### Editable fields

- Callsign.
- Aircraft type.
- Departure aerodrome.
- Reference fix.
- ETO.
- TLDT.
- ALDT.
- Status.

### Calculated fields

- `ELDT = ETO + nominal REF FIX → landing time`.
- `CTO = TLDT - nominal REF FIX → landing time`.
- Estimate variance from ALDT versus ELDT.
- Sequence variance from ALDT versus TLDT.

### TLDT workflow

- TLDT initially follows ELDT.
- Controller may override TLDT for sequencing.
- Override state is visibly marked.
- `Reset` returns TLDT to ELDT.
- CTO automatically moves with the sequence adjustment.
- Timing workflow helper visually distinguishes:
  - ETO = INPUT;
  - ELDT = AUTO ESTIMATE;
  - TLDT = TARGET;
  - CTO = AUTO TARGET.
- A timing mismatch warning appears if the TLDT / ELDT adjustment does not agree with the CTO / ETO adjustment.

## 5. Sequence spacing guard

- Compares all active TLDTs, not only adjacent table rows.
- Warns when two active flights have a TLDT gap below the current **2-minute planning target**.
- Detects identical TLDTs.
- Handles midnight wrap-around such as `23:59` vs `00:00`.
- Shows the conflicting sequence number and callsign.
- LANDED and CANCELLED flights are excluded from spacing checks.

> The 2-minute value is a sequencing planning warning in this application. It is not presented as a universal separation minimum.

## 6. Flight lifecycle controls

Supported statuses:

- `INBOUND`
- `SEQUENCED`
- `LANDING`
- `LANDED`
- `CANCELLED`

Additional workflow features:

- Active / Completed / All tabs.
- Completed includes LANDED and CANCELLED flights.
- `Landed Now` stamps current UTC as ALDT and marks the flight LANDED.
- Quick Cancel action.
- Cancelled flights can be restored to INBOUND.
- Flight deletion with confirmation.
- Lifecycle-aware summary cards and spacing logic.

## 7. Sequence summary cards

The live page displays:

- active flights in sequence;
- total sequence rows;
- next landing by TLDT;
- callsign of the next landing;
- average TLDT interval;
- number of controllers online.

## 8. Search and rapid data entry

- Search by callsign.
- Search by aircraft type.
- Search by departure aerodrome.
- Search by reference fix.
- Spreadsheet-style keyboard navigation across editable cells.
- `Enter` moves vertically through rows.
- `Shift+Enter` moves upward.
- Arrow-key navigation between editable cells.
- Newly added manual rows automatically focus the first editable input.
- ATC times use 24-hour `HH:MM` UTC entry and automatically normalize numeric typing.
- Midnight / service-date anchoring is handled when converting clock values to timestamps.

## 9. Field Guide

Built-in Field Guide explains the operational fields and abbreviations used by the board, including:

- SEQ
- CALLSIGN
- A/C
- DEP
- REF FIX
- ETO
- ELDT
- TLDT
- CTO
- ALDT
- EST VAR
- SEQ VAR
- STATUS

The guide also explains which values are input, calculated, or controller planning values.

---

# IVAO Traffic and AUTO ETO

The IVAO Traffic panel is designed to reduce manual arrival data entry while keeping controller override available.

## 10. Live IVAO inbound discovery

For the selected destination airport, the panel shows connected IVAO arrivals with available data such as:

- callsign;
- aircraft type;
- departure aerodrome;
- IVAO VID;
- altitude;
- groundspeed;
- flight state;
- latitude / longitude;
- heading;
- filed route;
- airline logo when available.

Flights already present in the sequence are marked `In sequence` and cannot be added again from the panel.

## 11. Full filed-flight-plan route display

- Filed route is shown directly below the flight details.
- Long routes wrap to multiple lines instead of being truncated to `...`.
- This allows the controller to see whether the selected sequencing fix or STAR-related waypoint was actually filed.

## 12. Filed-route geometry resolution

AUTO ETO uses route geometry resolved through the server-side `/api/sequence/route-geometry` endpoint.

Current route source:

```text
IVAO filed route
      ↓
Cloudflare Pages Function
      ↓
airac.net route parser
      ↓
waypoints + leg distances + cumulative route distance
```

- Route geometry is cached.
- Aircraft live position is projected onto the parsed route.
- The application determines approximate progress along the filed route.
- Configured reference fixes ahead of the aircraft are detected from the parsed geometry.

## 13. AUTO reference-fix selection

- If the filed route contains a configured STAR designator (for example `SABAI3A`), the system maps that procedure through `star_procedures` and prioritizes its configured entry fix (for example `SABAI`) as the REF FIX.
- This STAR-designator mapping takes priority over an earlier configured waypoint that also appears in the en-route portion of the FPL.
- If the route parser does not expand the STAR procedure into its entry fix, the estimator bridges the resolved filed route to the mapped STAR entry for planning while labelling it as `FILED STAR ... · STAR ENTRY ... · ROUTE→STAR ENTRY`.
- If no STAR designator is filed, the system next applies CAAT AIP ENR 1.10 §4.3 transition-to-IAWP mappings for VTBD and VTBS. Examples include `HOTEL → SABAI` for VTBD, `HOTEL → LEBIM` for VTBS, `BLAFF/NOBER/SEMBO/ALBOS → NAKON` for VTBD and `→ NORTA` for VTBS, and the published east/west/north/south IAWP transitions.
- AIP-derived mappings are labelled `AIP IAWP <fix> · FROM <transition>`; if the filed route stops at the transition waypoint, the estimator extends the planning geometry to the mapped IAWP and labels it `ROUTE→IAWP`.
- Otherwise the system prefers the next configured reference fix that is still ahead on the resolved route.
- If all configured fixes have already been passed, it selects the most recently passed configured fix when possible.
- Controller can manually choose another REF FIX at any time.

## 14. AUTO ETO using live groundspeed

For a REF FIX ahead of the aircraft:

```text
ETO = current UTC + remaining route distance to REF FIX / live GS
```

Details:

- Uses live IVAO groundspeed.
- Valid GS samples are smoothed using recent samples to reduce single-sample fluctuation.
- Uses filed-route distance rather than simple point-to-point distance when route geometry is available.
- Includes route-position deviation in the estimate.
- Refuses automatic estimation when required live / route data are not usable.

## 15. Configurable AUTO ETO look-ahead window

Controller can select when AUTO ETO starts filling the ETO field:

- ETA ≤ 30 min
- ETA ≤ 45 min
- ETA ≤ 60 min
- ETA ≤ 90 min
- ETA ≤ 120 min
- ETA ≤ 180 min
- ETA ≤ 240 min (4 hours)

The selected value is stored locally in the browser.

The trigger is based on estimated time remaining to the **destination**, while the ETO value itself is calculated for the selected **REF FIX**.

### Thailand domestic EET-after-takeoff trigger

For Thailand domestic flights (`departure.countryId = TH` and `arrival.countryId = TH`), the look-ahead trigger uses IVAO Tracker data instead of deriving destination ETA only from the aircraft's current groundspeed:

```text
IVAO latest flight plan → filed EET
IVAO track history → first onGround true → false transition
tracked wheels-off timestamp + filed EET
        ↓
filed destination ETA baseline
        ↓
ETA ≤ selected 30 / 45 / 60 / 90 / 120 / 180 / 240 min window
        ↓
AUTO ETO uses current route geometry + current smoothed live GS to the REF FIX
```

- The takeoff anchor is the first tracked airborne sample after a confirmed on-ground sample.
- The application does **not** treat FPL `departureTime` as actual takeoff time.
- Tracker `actualDepartureTime` is not used as the primary wheels-off source because observed track history can differ from that value.
- Once a tracked takeoff is found, it is cached so the full track history does not need to be fetched on every refresh.
- Before takeoff, the panel shows that the domestic flight is waiting for tracked wheels-off.
- If domestic EET / takeoff enrichment is unavailable, the existing live-route calculation remains available as a fallback once usable live data exists.

## 16. Passed REF FIX back-estimation

If the selected REF FIX exists in the resolved filed route but the aircraft has already passed it, the system can estimate the past crossing time instead of leaving ETO blank.

Conceptually:

```text
estimated crossing time
  = current UTC
  - estimated distance flown since REF FIX / current smoothed GS
```

The UI clearly labels this as an estimated past crossing, for example:

```text
EST PAST XING
```

This allows a flight to be added to the sequence even if the sequencing tool was opened after the aircraft crossed the reference fix.

## 17. Unfiled REF FIX assumed-DCT fallback

If the selected REF FIX is **not present in the filed route**, the system may attempt a planning fallback by extending the filed route with an assumed direct leg:

```text
<filed route> DCT <selected REF FIX>
```

It re-runs route geometry resolution using that assumed route and, if usable, produces an AUTO ETO.

The estimate is explicitly labelled:

```text
REF FIX NOT FILED · ASSUMED DCT
```

This is intended for cases where the pilot did not file the expected STAR / sequencing fix but the controller still needs a planning estimate.

## 18. Manual AUTO ETO override

- Controller can type ETO manually at any time.
- Manual input is preserved during automatic refreshes.
- If an automatic estimate later becomes available, the panel offers `Use auto` to return to the automatic value.
- Changing REF FIX manually recalculates the automatic estimate for that fix, including the assumed-DCT fallback when applicable.

### Add All and automatic unfiled REF FIX assignment

- The IVAO Traffic panel includes `Add All (N)` for bulk insertion of every non-duplicate flight that currently has a valid REF FIX and ETO.
- Bulk insertion assigns consecutive sequence numbers so multiple rows can be created safely in one action.
- Flights that are still outside the selected AUTO ETO window, waiting for domestic tracked takeoff, or otherwise unavailable are skipped and remain visible for later addition.
- When a configured STAR entry / REF FIX is present in the resolved filed route, that filed fix is preferred.
- When no configured REF FIX is filed, the panel evaluates each configured fix using an assumed-DCT continuation and automatically selects the usable candidate with the shortest remaining distance to the fix.
- Auto-selected unfiled fixes are explicitly labelled `REF FIX NOT FILED · AUTO ASSIGNED · ASSUMED DCT`.
- This automatic assignment is a sequencing-planning fallback only. It does not modify the pilot's IVAO flight plan and does not represent an ATC STAR clearance.

## 19. IVAO panel refresh behaviour

- Refreshes automatically every 30 seconds while the panel is open.
- Manual Refresh button is available.
- Auto-refresh pauses after 10 minutes of user inactivity.
- Activity resumes refresh behaviour.
- Route / geometry requests are cached to reduce repeated parser calls.

---

# Activity and auditability

## 20. Live activity panel

- Arrival changes are recorded in audit logs.
- Activity view groups changes by flight.
- Shows controller / actor label and UTC change time.
- Tracks visible changes to callsign, aircraft type, departure, REF FIX, ETO, TLDT, ALDT and status.
- Insert and delete activity is also represented.

## 21. Historical timing safety

- Arrival rows retain `nominal_seconds_snapshot`.
- Later changes to master timing do not rewrite historical arrival calculations.
- Master-data history is append-only.

---

# Staff Admin Console

Available at `/admin` for recognized Thailand Division staff.

## 22. Airport master data

- Create / edit airport master records.
- ICAO, name, city and FIR metadata.
- Active state.
- Published state.
- Archive / restore workflow instead of destructive deletion.

## 23. Runway configuration master data

- Multiple runway / flow configurations per airport.
- Flow code and display label.
- Sort order.
- Notes.
- Active state.
- Published state.
- Timing state:
  - `ACTIVE`
  - `PENDING`
  - `DISABLED`

Publishing and timing activation are separate controls.

## 24. STAR procedure editor

STAR records are optional and editable per runway configuration.

Stored fields include:

- STAR designator;
- entry fix;
- runway applicability;
- chart reference;
- source;
- effective-from / effective-to dates;
- active state.

## 25. AIP STAR Importer

Two import modes are supported.

### Automatic CAAT eAIP mode

- Checks CAAT Published eAIPs.
- Resolves the latest effective AIRAC issue.
- Reads the relevant `GEN 3.2` chart-list content.
- Extracts Standard Arrival Chart / STAR metadata.

### Uploaded PDF mode

- Parses an uploaded AIP PDF with PDF.js in the browser.
- Searches for STAR chart-list information.
- Extracts designators, runway applicability, chart references and chart dates.

### Review workflow

Preview statuses include:

- `NEW`
- `CHANGED`
- `SAME`
- `REVIEW`
- `UNMAPPED`

Additional safeguards:

- Imported procedures are mapped to existing airport / runway master records.
- Unknown airport or runway configurations are shown as UNMAPPED instead of being guessed and created automatically.
- Entry-fix candidates are editable during review.
- Rows without a source-backed chart effective date require review.
- Staff explicitly selects and approves rows before database writes.
- Import never changes `fix_timings`.
- Missing procedures are not automatically archived.

## 26. Reference-fix timing editor

- Uses the same `fix_timings` data consumed by the live sequencing board.
- Timing is scoped by airport and flow.
- Effective-date support.
- Active / inactive records.
- Source / verification state.
- Live workspace only enables normal Add Flight workflow when Timing Active and usable timing records exist.

## 27. Configuration history and rollback

- Master-data edits are recorded in `config_history`.
- Field-level old / new values are retained.
- Actor identity is stored.
- History is append-only.
- Staff can roll back supported configuration changes from the Admin Console.

## 28. Session administration

- View sequence sessions.
- Close sessions.
- Reopen sessions.
- Archive sessions.
- Restore archived sessions.
- Session detail includes stored arrivals and statistics.
- CSV export support.
- Archived sessions are excluded from normal live session selection.

## 29. Admin health / readiness support

- Staff diagnostic endpoint: `/api/admin/health`.
- Used to verify Published + Timing Active workspace readiness.

---

# Security model

## 30. Server-side live writes

- Live sequence writes go through authenticated Cloudflare Pages Functions.
- `/api/sequence/*` requires a valid IVAO session.
- Browser Supabase access is read / realtime only for live sequence data.
- Direct browser INSERT / UPDATE / DELETE access to `arrivals` and `sequence_sessions` is revoked.
- Server uses the Supabase service-role key for protected writes.

## 31. Server validation

- Session creation requires an Active + Published airport / runway configuration.
- Arrival create / update / delete requires an ACTIVE, non-archived session.
- Editable arrival fields and statuses are allow-listed server-side.
- Actor VID is stamped from the signed server session rather than trusted browser input.
- Staff Admin routes use separate Thailand Division staff middleware.

## 32. Data integrity safeguards

- Airport / runway / STAR data use archive / restore rather than destructive deletion.
- Partial uniqueness guard prevents more than one non-archived ACTIVE session for the same airport, flow and service date.
- Arrival preparation derives timing from the arrival session's actual airport + flow.
- No VTBD-only timing lookup is embedded in the live sequencing trigger.
- Database airport fields support arbitrary four-character A-Z / 0-9 codes for future expansion.

---

# Current production master-data state

## VTBD — Don Mueang International Airport

- Airport: **Published**
- RWY `21L / 21R`, flow `21`: **Published / Timing Active**
- RWY `03L / 03R`, flow `03`: **Not Published / Timing Pending**
- Current RWY 21 STAR records include:
  - ENDUU3A
  - NAKON3A
  - SABAI3A
  - SEHNA3A
  - WEHHA3A

## VTBS — Suvarnabhumi Airport

- Airport: **Not Published**
- `01 / 02L / 02R`: Not Published / Timing Pending
- `19 / 20L / 20R`: Not Published / Timing Pending
- Multi-airport live support exists, but VTBS should not be enabled until source-backed nominal timing is configured and Timing status is Active.

---

# Tech stack

- React 19
- TypeScript
- Vite
- Supabase PostgreSQL
- Supabase Realtime
- Cloudflare Pages
- Cloudflare Pages Functions
- IVAO OAuth / API
- PDF.js for AIP PDF import
- airac.net route parser for filed-route geometry

---

# Project structure

```text
src/
  App.tsx                  Live arrival sequencing workspace
  IvaoTrafficPanel.tsx     IVAO inbound / AUTO ETO workflow
  AuthGate.tsx             IVAO authentication gate
  AdminPanelV2.tsx         Staff Admin Console
  AirportEditor.tsx        Airport / runway master data
  StarEditor.tsx           STAR master data
  AipImporter.tsx          CAAT / PDF STAR importer
  TimingEditor.tsx         Reference-fix timing editor
  SessionsPanel.tsx        Session administration
  HistoryPanel.tsx         Configuration history / rollback
  spacingGuard.ts          TLDT planning-gap warnings
  timeWorkflow.ts          ETO → ELDT → TLDT → CTO workflow helpers
  lifecyclePanel.ts        Active / Completed / Activity workflow
  restoreCancelled.ts      Restore cancelled flights
  spreadsheetNavigation.ts Keyboard-oriented table navigation
  fieldGuide.ts            In-app field definitions

functions/api/
  auth/                     IVAO authentication endpoints
  admin/                    Protected staff APIs
  sequence/                 Protected live sequencing APIs

supabase/
  migrations/               Database schema, security and feature migrations
```

---

# Local development

## Requirements

- Node.js
- npm
- Supabase project
- IVAO OAuth application / API credentials

## Install

```bash
npm install
```

Copy `.env.example` and configure the required environment values.

Browser / Vite values:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Cloudflare Pages Functions values / secrets:

```env
IVAO_CLIENT_ID=
IVAO_CLIENT_SECRET=
IVAO_API_KEY=
SESSION_SECRET=
IVAO_REDIRECT_URI=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_URL=
```

Run locally:

```bash
npm run dev
```

Production build:

```bash
npm run build
```

---

# Before publishing another live workspace

Verify all of the following:

1. Airport is Active + Published.
2. Runway configuration is Active + Published.
3. Timing status is Active.
4. Active reference-fix timing records exist.
5. Timing records have a documented / reviewed source.
6. STAR records exist only where they are actually applicable.
7. Workspace URL resolves the intended airport / flow / runway.
8. Correct sequence session is loaded or created.
9. Add Flight is enabled only when the timing dataset is usable.
10. `/api/admin/health` reports the workspace ready.
11. GitHub Build check is green.

---

# Known planning-estimate limitations

AUTO ETO is deliberately labelled as a planning estimate. Accuracy can be affected by:

- pilot-filed route quality;
- route-parser resolution;
- shortcuts / vectors / direct clearances not reflected in the FPL;
- live position update frequency;
- current groundspeed not representing future groundspeed;
- use of current / recent GS to back-estimate a passed REF FIX;
- assumed-DCT fallback when the selected REF FIX was not filed.

Manual controller override remains available for these reasons.

---

## Project status

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the operational master-data state, deployment notes, security boundary, deferred datasets and readiness checklist.
