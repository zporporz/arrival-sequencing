# AMAN realtime deployment

The web application remains a Cloudflare Pages project. Realtime coordination is
provided by the separate `aman-realtime` Worker because a Pages project can bind
to a Durable Object but cannot define and deploy that Durable Object itself.

## One-time Cloudflare setup

1. Authenticate Wrangler with the Cloudflare account that owns `atc-sequence`.
2. Deploy the Durable Object Worker:

   ```powershell
   npx wrangler@latest deploy --config realtime-worker/wrangler.jsonc
   ```

3. In **Workers & Pages > atc-sequence > Settings > Bindings**, add a Durable
   Object binding for both Production and Preview:

   - Variable name: `AMAN_REALTIME`
   - Worker: `aman-realtime`
   - Durable Object class: `AmanRealtimeRoom`

   The root `wrangler.jsonc` records the same binding for Wrangler-based Pages
   deployments. Dashboard-managed Git deployments still require the binding in
   the dashboard.

4. Redeploy the Pages project after adding the binding.

No new secret is required. `/api/sequence/realtime` is under the existing
IVAO-session middleware and passes verified controller identity to the bound
Durable Object. The Worker itself exposes no public room route.

## Runtime behaviour

- One room is created per UTC service date and airport.
- The first connected browser supplies the canonical AUTO ETA snapshot. Every
  later browser receives that snapshot on connection, so ETA stage and timeline
  values converge immediately.
- Drag previews are broadcast at most every 80 ms and are never persisted.
- Pointer-up persists the existing shared state to Supabase, then broadcasts the
  returned row/revision as the committed value.
- Supabase polling remains enabled as reconciliation and outage fallback.
- `SYSTEM > RT LIVE` means both VTBD and VTBS WebSockets are connected.
  `RT DEGRADED` means the app is safely using the existing polling fallback.

## Verification

Open two authenticated browsers, select the same airport and confirm:

1. `SYSTEM` reports `RT LIVE` on both.
2. AUTO ETA-FF/TLDT values match after the initial snapshot arrives.
3. Dragging a live flight moves its preview on the other browser before release.
4. Releasing commits the same manual target and sequence revision on both.
5. Stopping the realtime Worker changes the status to `RT DEGRADED`; shared state
   must still converge through the protected five-second polling fallback.
