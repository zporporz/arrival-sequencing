# Shared operational traffic polling

The main AMAN view, Final/Frozen sensor, and operational speed advisory now
subscribe to `src/core/ivaoTrafficFeed.ts`. For each selected airport in one tab,
one request to `ivao-traffic` starts immediately and then every 15 seconds. Each
consumer receives the same result on arrival; there is no extra 15-second cache
poll for a late subscriber. The latest result is replayed on subscription within
the current interval, including failures (not an older successful sample).

Requests do not overlap. A request times out after 10 seconds and the next
scheduled tick retries. An airport failure does not disable other airports.
The last unsubscription cancels that airport's timer/request and discards its
snapshot. Synchronous React re-subscriptions retain the existing request/timer.

Recompute requests a fresh sample immediately for its airport, sharing any
already pending request. Regional operational predictions reuse the same traffic
while retaining their existing AIRAC checks. The standalone regional-preview and
summary responses are not mixed into the operational feed.

## Request estimate

Assumptions: one active browser tab, BD + BS selected, steady successful polling,
no manual refreshes/recomputes, no browser background throttling.

| Requests per hour | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Operational traffic only, per airport | 720 | 240 | 480 |
| Operational traffic only, BD + BS | 1,440 | 480 | 960 |
| Fixed polling baseline, BD + BS | 4,260 | 3,300 | 960 |

Traffic requests fall by 66.7%. Against the previously identified fixed polling
baseline, this is 22.5%, **not** a 66.7% reduction in total application requests.
At uninterrupted 24-hour cadence, the traffic saving is 23,040 requests per tab.
Each tab/browser still has its own feed; this does not share HTTP traffic between
controllers. Do not apply these percentages directly to Cloudflare's 168k chart.

The fixed baseline includes traffic, final-approaches (480/hour), landed-history
(480/hour), presence (1,080/hour), shared AMAN state (720/hour), and operational
config (60/hour). It excludes aircraft-performance requests, route resolutions,
regional navdata, reconnects, startup, scope changes, user actions, writes, and
retries. Aircraft count and usage patterns therefore change the actual total
percentage saved. Production savings must be measured after deployment.

## Unchanged

- Traffic cadence: 15 seconds; local sensor application/decorating: 1 second.
- TLDT/STA-FF/ETA formulas, Frozen geometry, manual targets, drag WebSocket
  messages, save/commit handling, shared-state and presence polling.
- Approach caching and reduction of other polling are separate work.

## Follow-up: profile batches and unchanged timing config

The Bangkok AMAN calculation now creates an `aircraftPerformanceBatch` for each
airport snapshot calculation. Repeated normalized aircraft types share the same
pending/completed result within that batch. A new snapshot, Recompute, or real
config change starts a new batch; there is no added cross-refresh TTL. Failed
requests retain the previous null-profile fallback and retry in the next batch.
Different models remain distinct (for example A320 and A20N). Regional profile
caching and the separate category fallback are unchanged. There is no sharing
between airports, browser tabs, or users in this follow-up.

The 60-second operational timing config read and forced reads are unchanged.
`retainUnchangedOperationalConfig` preserves React state identity when only the
root `generatedAt` timestamp or JSON object-key ordering changes. It compares all
other fields, including service date, flow, timing values, effective dates,
verification, update metadata, and future fields. Array order remains meaningful.
Real changes still update state and recalculate immediately upon receipt; errors
still clear on a successful read. The shared workspace/LAND SEP five-second poll
is a separate path and is untouched.

### Cumulative estimate, not measured production savings

Let N be the total flights needing a Bangkok profile across the selected
airports, and K the **sum of distinct types per airport**. At 240 snapshots/hour,
the counted baseline changes from `4,260 + 240*N` to `3,300 + 240*K` requests/hour.
This deliberately excludes extra config-triggered calculations on the old code
(and their savings), just as it excludes other variable requests listed above.

For BD+BS selected and N=10:

| Counted requests/hour | K=3 | K=6 |
| --- | ---: | ---: |
| Before both rounds of optimization | 6,660 | 6,660 |
| After traffic-feed consolidation only | 5,700 | 5,700 |
| After profile batching + unchanged-config guard | 4,020 | 4,740 |
| Cumulative reduction against this baseline | 39.6% | 28.8% |

K=3 is possible with the example's ten flights/three types at one airport and no
profile-requiring flights at the other. If the same three types occur at both
airports, K=6, not 3. Savings do not add as percentage points: for K=3 the second
round saves 29.5% of the post-first-round counted baseline, producing 39.6% total.
The config guard can save additional work/requests, but its incremental percentage
depends on actual reprocessing and overlapping polls. No universal percentage is
promised; ten different types would save no profile calls at all. More tabs still
multiply requests. Do not apply the example directly to the historical 168k chart.

## Verification

- `ivao-traffic-feed.test.ts`: virtual hour (480 traffic requests for two airports
  and three consumers), late subscribers, explicit refresh, request sharing,
  errors, timeout/recovery, unmount/cancellation, and consumer isolation.
- `traffic-feed-integration.test.tsx`: actual AMAN view with both sensor/advisory
  runtimes, 15-second sensor updates, scoped Recompute, deselection and recovery.
- Regional tests verify reuse without another traffic request and preserve AIRAC
  invalidation and preview/airport isolation.
- `aircraft-performance-batch.test.ts`: ten flights/three types over 240 batches
  use 720 requests instead of 2,400; normalization, concurrent/completed sharing,
  fresh batches, and failure recovery.
- `operational-config-identity.test.ts`: timestamp-only changes preserve identity;
  all operational fields and future-field changes are retained, without mutation.
- `traffic-calculation-requests.test.tsx`: actual AMAN component, four 15-second
  refreshes use 12 profile requests/40 flight calculations while the unchanged
  60-second config poll does not replay them. Also covers forced refresh, real
  timing changes/removal, failures, scoped Recompute, and shared SEP 5-to-7 on the
  next normal five-second poll without echo writes.

All tests use local fixtures. Live multi-browser and production request counts
have not been measured for this change.
