from pathlib import Path

TSX = Path('src/IvaoTrafficPanel.tsx')
CSS = Path('src/ivaoTraffic.css')
text = TSX.read_text()
css = CSS.read_text()

old = "  crossingAgeMin?: number | null\n}"
new = "  crossingAgeMin?: number | null\n  assumedDirect?: boolean\n}"
if old not in text:
    raise SystemExit('AutoEstimate type marker not found')
text = text.replace(old, new, 1)

marker = "  }, [airport])\n\n  const refresh = useCallback(async () => {"
if marker not in text:
    raise SystemExit('getRouteGeometry end marker not found')
assumed_cb = r'''  }, [airport])

  const getAssumedRouteGeometry = useCallback(async (flight: TrafficFlight, refFix: string) => {
    if (!flight.departure || !flight.route || !refFix) return null
    const assumedRoute = `${flight.route} DCT ${refFix}`.trim().replace(/\s+/g, ' ')
    const key = `${flight.departure}|${airport}|ASSUMED-DCT|${assumedRoute}`
    if (geometryCacheRef.current.has(key)) return geometryCacheRef.current.get(key) ?? null
    const pending = geometryPendingRef.current.get(key)
    if (pending) return pending

    const request = (async () => {
      try {
        const response = await fetch('/api/sequence/route-geometry', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: flight.departure, destination: airport, route: assumedRoute }),
        })
        const payload = await response.json() as RouteGeometryPayload
        if (!response.ok) throw new Error(payload.error || `Route geometry returned ${response.status}`)
        geometryCacheRef.current.set(key, payload)
        return payload
      } catch {
        return null
      } finally {
        geometryPendingRef.current.delete(key)
      }
    })()

    geometryPendingRef.current.set(key, request)
    return request
  }, [airport])

  const refresh = useCallback(async () => {'''
text = text.replace(marker, assumed_cb, 1)

old = "        const estimate = autoEstimate(flight, geometry, refFix, gs, nextFetchedAt, lookaheadMin)\n        const etoManual = previous?.etoManual ?? false"
new = r'''        let estimate = autoEstimate(flight, geometry, refFix, gs, nextFetchedAt, lookaheadMin)
        if (estimate.status === 'unavailable' && estimate.reason === 'REF FIX not in filed route' && refFix) {
          const assumedGeometry = await getAssumedRouteGeometry(flight, refFix)
          if (assumedGeometry) {
            const assumedEstimate = autoEstimate(flight, assumedGeometry, refFix, gs, nextFetchedAt, lookaheadMin)
            if (assumedEstimate.status === 'ready' || assumedEstimate.status === 'waiting') {
              estimate = { ...assumedEstimate, assumedDirect: true }
            }
          }
        }
        const etoManual = previous?.etoManual ?? false'''
if old not in text:
    raise SystemExit('refresh estimate marker not found')
text = text.replace(old, new, 1)

old = "  }, [airport, fixes, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed])"
new = "  }, [airport, fixes, getAssumedRouteGeometry, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed])"
if old not in text:
    raise SystemExit('refresh dependency marker not found')
text = text.replace(old, new, 1)

start = text.index("  const changeRefFix = (")
end = text.index("\n  const changeEto =", start)
replacement = r'''  const changeRefFix = async (flight: TrafficFlight, refFix: string) => {
    const current = draftsRef.current[flight.sessionId] || { refFix, eto: '', refFixManual: false, etoManual: false }
    const geometry = geometryCacheRef.current.get(routeKey(flight, airport)) ?? null
    const gsSamples = gsHistoryRef.current.get(flight.sessionId) || []
    const gs = gsSamples.length ? gsSamples.reduce((sum, value) => sum + value, 0) / gsSamples.length : flight.groundSpeed
    const baseTime = fetchedAt || new Date().toISOString()
    let estimate = autoEstimate(flight, geometry, refFix, gs, baseTime, lookaheadMin)
    if (estimate.status === 'unavailable' && estimate.reason === 'REF FIX not in filed route') {
      const assumedGeometry = await getAssumedRouteGeometry(flight, refFix)
      if (assumedGeometry) {
        const assumedEstimate = autoEstimate(flight, assumedGeometry, refFix, gs, baseTime, lookaheadMin)
        if (assumedEstimate.status === 'ready' || assumedEstimate.status === 'waiting') {
          estimate = { ...assumedEstimate, assumedDirect: true }
        }
      }
    }
    const nextDraft = {
      ...current,
      refFix,
      refFixManual: true,
      eto: current.etoManual ? current.eto : (estimate.status === 'ready' ? estimate.eto : ''),
    }
    const next = { ...draftsRef.current, [flight.sessionId]: nextDraft }
    setDraftState(next)
    setAutoEstimates((all) => ({ ...all, [flight.sessionId]: estimate }))
  }
'''
text = text[:start] + replacement + text[end:]

start = text.index("function estimateText(")
end = text.index("\nexport default function IvaoTrafficPanel", start)
estimate_text = r'''function estimateText(estimate: AutoEstimate | undefined, manual: boolean, lookaheadMin: number) {
  if (!estimate) return 'AUTO ETO · waiting for route data'
  if (manual) {
    if (estimate.status === 'ready') {
      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available'
      if (estimate.pastCrossing) return 'MANUAL ETO · estimated past crossing ' + estimate.refFix + ' ' + estimate.eto + 'Z available'
      return 'MANUAL ETO · auto estimate ' + estimate.eto + 'Z available'
    }
    return 'MANUAL ETO · automatic estimate not applied'
  }
  if (estimate.status === 'ready') {
    if (estimate.assumedDirect) {
      const past = estimate.pastCrossing ? ' · EST PAST XING' : ''
      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · REF FIX NOT FILED · ASSUMED DCT' + past + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0)
    }
    if (estimate.pastCrossing) {
      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · EST PAST XING · ~' + Math.round(estimate.remainingNm || 0) + ' NM / ' + Math.max(1, Math.round(estimate.crossingAgeMin || 0)) + ' min ago · GS ' + Math.round(estimate.groundSpeed || 0)
    }
    return 'AUTO ETO · ' + estimate.refFix + ' ' + estimate.eto + 'Z · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0)
  }
  if (estimate.status === 'waiting') {
    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED · ASSUMED DCT · ETA >' + lookaheadMin + ' min'
    if (estimate.pastCrossing) return 'AUTO ETO waiting · ' + estimate.refFix + ' already passed ~' + Math.max(1, Math.round(estimate.crossingAgeMin || 0)) + ' min ago · ETA >' + lookaheadMin + ' min'
    return 'AUTO ETO waiting · ~' + Math.ceil(estimate.minutes || 0) + ' min to destination · auto-fill starts ETA ≤' + lookaheadMin + ' min'
  }
  if (estimate.status === 'calculating') return 'AUTO ETO · ' + (estimate.reason || 'calculating')
  return 'AUTO ETO unavailable · ' + (estimate.reason || 'insufficient data')
}
'''
text = text[:start] + estimate_text + text[end:]

old = "className={`ivao-auto-eto ${draft.etoManual ? 'is-manual' : estimate?.pastCrossing && estimate?.status === 'ready' ? 'is-past' : estimate?.status === 'ready' ? 'is-ready' : estimate?.status === 'waiting' ? 'is-waiting' : ''}`}"
new = "className={`ivao-auto-eto ${draft.etoManual ? 'is-manual' : estimate?.assumedDirect && estimate?.status === 'ready' ? 'is-assumed' : estimate?.pastCrossing && estimate?.status === 'ready' ? 'is-past' : estimate?.status === 'ready' ? 'is-ready' : estimate?.status === 'waiting' ? 'is-waiting' : ''}`}"
if old not in text:
    raise SystemExit('AUTO ETO class marker not found')
text = text.replace(old, new, 1)

old = "onChange={(event) => changeRefFix(flight, event.target.value)}"
new = "onChange={(event) => void changeRefFix(flight, event.target.value)}"
if old not in text:
    raise SystemExit('REF FIX onChange marker not found')
text = text.replace(old, new, 1)

old = "AUTO ETO uses filed-route distance + live GS when estimated arrival is inside the selected ETA window. Manual override remains available."
new = "AUTO ETO uses filed-route distance + live GS. If the selected REF FIX is not filed, the system may extend the filed route with an assumed DCT to that fix and labels the estimate accordingly."
if old not in text:
    raise SystemExit('header copy marker not found')
text = text.replace(old, new, 1)

css_marker = ".ivao-auto-eto.is-past { background: #fff3e3; color: #995d0d; }\n"
if css_marker not in css:
    raise SystemExit('past CSS marker not found')
css = css.replace(css_marker, css_marker + ".ivao-auto-eto.is-assumed { background: #fff6df; color: #8a6418; }\n", 1)

TSX.write_text(text)
CSS.write_text(css)
