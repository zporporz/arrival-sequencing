import { readIvaoTraffic, type IvaoTrafficPayload } from './api'
import { AMAN_ETA_FF_REFRESH_MS } from './amanConstants'
import type { AirportCode } from './airports'

export type IvaoTrafficUpdate = {
  airport: AirportCode
} & ({ payload: IvaoTrafficPayload; error: null } | { payload: null; error: Error })

type Listener = (update: IvaoTrafficUpdate) => void
type FetchTraffic = (airport: AirportCode, signal: AbortSignal) => Promise<IvaoTrafficPayload>

// One operational traffic request per airport per tab. Consumers receive each
// response together, rather than polling a TTL cache on three different clocks.
// Preview/summary requests are not cached here. Recompute can request a fresh
// sample immediately; an already pending request is shared, never duplicated.
export function createIvaoTrafficFeed(fetchTraffic: FetchTraffic = (airport, signal) => readIvaoTraffic(airport, undefined, signal)) {
  type Channel = {
    airport: AirportCode
    listeners: Set<Listener>
    timer: ReturnType<typeof setInterval>
    pending: AbortController | null
    latest: { update: IvaoTrafficUpdate; receivedAt: number } | null
  }
  const channels = new Map<AirportCode, Channel>()

  function deliver(listener: Listener, update: IvaoTrafficUpdate) {
    // A UI consumer must not turn a successful request into a feed failure or
    // prevent the other consumers from receiving the same sample.
    try { listener(update) } catch (error) { console.error('Traffic consumer failed', error) }
  }

  async function refresh(channel: Channel) {
    if (channel.pending || !channel.listeners.size) return
    const controller = new AbortController()
    channel.pending = controller
    const timeout = setTimeout(() => controller.abort(new DOMException('Traffic request timed out', 'TimeoutError')), 10_000)
    let update: IvaoTrafficUpdate
    try {
      const payload = await fetchTraffic(channel.airport, controller.signal)
      controller.signal.throwIfAborted()
      if (payload.airport !== channel.airport || !Array.isArray(payload.flights)) throw new Error('Invalid traffic response')
      update = { airport: channel.airport, payload, error: null }
    } catch (error) {
      update = { airport: channel.airport, payload: null,
        error: error instanceof Error || error instanceof DOMException ? error : new Error(String(error)) }
    } finally {
      clearTimeout(timeout)
      channel.pending = null
    }
    if (channels.get(channel.airport) !== channel || !channel.listeners.size) return
    channel.latest = { update, receivedAt: Date.now() }
    for (const listener of channel.listeners) deliver(listener, update)
  }

  function subscribe(airport: AirportCode, listener: Listener) {
    let channel = channels.get(airport)
    if (!channel) {
      const created: Channel = { airport, listeners: new Set(), pending: null, latest: null,
        timer: setInterval(() => void refresh(created), AMAN_ETA_FF_REFRESH_MS) }
      channel = created
      channels.set(airport, channel)
    }
    const subscription: Listener = update => listener(update)
    channel.listeners.add(subscription)
    const age = channel.latest ? Date.now() - channel.latest.receivedAt : Infinity
    if (channel.latest && age >= 0 && age < AMAN_ETA_FF_REFRESH_MS) {
      deliver(listener, channel.latest.update)
    } else {
      void refresh(channel)
    }
    const subscribed = channel
    return () => {
      subscribed.listeners.delete(subscription)
      // React effect re-subscriptions/StrictMode happen in the same turn. Keep
      // their in-flight request and cadence, but release everything on unmount.
      void Promise.resolve().then(() => {
        if (subscribed.listeners.size || channels.get(airport) !== subscribed) return
        channels.delete(airport)
        clearInterval(subscribed.timer)
        subscribed.pending?.abort()
      })
    }
  }

  return { subscribe, refresh: (airport: AirportCode) => {
    const channel = channels.get(airport)
    if (channel) void refresh(channel)
  } }
}

const operationalTrafficFeed = createIvaoTrafficFeed()
export const subscribeIvaoTraffic = operationalTrafficFeed.subscribe
export const refreshIvaoTraffic = operationalTrafficFeed.refresh
