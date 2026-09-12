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
- Approach/profile caching and reduction of other polling are separate work.

## Verification

- `ivao-traffic-feed.test.ts`: virtual hour (480 traffic requests for two airports
  and three consumers), late subscribers, explicit refresh, request sharing,
  errors, timeout/recovery, unmount/cancellation, and consumer isolation.
- `traffic-feed-integration.test.tsx`: actual AMAN view with both sensor/advisory
  runtimes, 15-second sensor updates, scoped Recompute, deselection and recovery.
- Regional tests verify reuse without another traffic request and preserve AIRAC
  invalidation and preview/airport isolation.

All tests use local fixtures. Live multi-browser and production request counts
have not been measured for this change.
