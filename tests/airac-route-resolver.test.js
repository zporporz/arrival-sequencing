import { afterEach, describe, expect, it, vi } from 'vitest'
import { arrivalEntryExtension, createAiracRouteResolver, normalizeRunway } from '../functions/_lib/airacRouteResolver.js'
import transitions from '../shared/arrivalEntryTransitions.json'
import { onRequestPost } from '../functions/api/sequence/route-geometry.js'
import bundle from '../functions/_data/regional-arrivals.json'

const cycle = '2609'
const leg = (fix) => ({ fix_identifier: fix, fix_coordinates: { lat: 15, lon: 100 }, path_terminator: 'TF' })
const detail = (airport, identifier, kind, fix, runways) => ({ airport, identifier, type: { code: kind },
  available_runways: runways, common_route: kind === 'STAR' ? [leg(fix), leg('FINAL')] : [],
  transitions: {}, runway_transitions: Object.fromEntries(runways.map((r) => [r, kind === 'SID' ? [leg('EXIT'), leg(fix)] : []])) })
const procedures = [detail('VTBD', 'OLVU1B', 'SID', 'OLVUK', ['03L']), detail('VTCC', 'MARN2A', 'STAR', 'MARNI', ['36'])]
const point = (identifier, lat) => ({ identifier, type: identifier.startsWith('VT') ? 'airport' : 'waypoint', coordinates: { lat, lon: 100 } })
const routeData = (names = ['VTBD', 'OLVUK', 'UPMUT', 'MARNI', 'VTCC'], errors = []) => ({
  total_distance: (names.length - 1) * 60,
  segments: names.slice(1).map((name, i) => ({ from: point(names[i], i), to: point(name, i + 1), distance: 60, bearing: 0, cumulative_distance: (i + 1) * 60 })), errors,
})
function api(options = {}) {
  const calls = [], definitions = options.procedures || procedures
  const fetcher = vi.fn(async (url, init) => {
    const u = new URL(url), path = u.pathname.replace('/api/v1/', '')
    calls.push(u)
    if (options.fail?.(u)) throw new Error('Temporary outage')
    let data, pagination
    if (path === 'airac/current') data = { cycle: options.cycle?.() || cycle, expiration_date: '2099-10-01T00:00:00Z' }
    else if (path === 'procedures') {
      const rows = definitions.filter((p) => p.airport === u.searchParams.get('airport') && p.type.code === u.searchParams.get('type'))
        .map((p) => ({ airport: p.airport, identifier: p.identifier, type: p.type }))
      const page = Number(u.searchParams.get('page'))
      data = options.paginate ? rows.slice(page - 1, page) : rows
      pagination = { has_more: options.paginate ? page < rows.length : false }
    } else if (path.startsWith('procedures/')) {
      const [, airport, id] = path.split('/')
      data = definitions.find((p) => p.airport === airport && p.identifier === decodeURIComponent(id))
      if (!data) return Response.json({ error: 'not found' }, { status: 404 })
    } else if (path === 'routes/parse') data = options.parse?.(u) || routeData()
    else throw new Error(`Unexpected URL ${url}`)
    expect(init.headers['User-Agent']).toContain('ArrivalSequencing')
    return Response.json({ status: 'success', data, ...(pagination ? { pagination } : {}) },
      { headers: { 'X-AIRAC-Cycle': options.headerCycle?.(u) || options.cycle?.() || cycle } })
  })
  return { resolve: createAiracRouteResolver(fetcher), fetcher, calls }
}
const request = { origin: 'VTBD', destination: 'VTCC', route: 'OLVUK1B OLVUK Y26 MARNI MARNI2A', cycle, arrivalRunway: '36', entryFix: 'MARNI' }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('generic SID / STAR route resolution', () => {
  it('normalizes both procedures and infers a runway only from a single published choice', async () => {
    const a = api(), result = await a.resolve(request)
    expect(result.normalizedRoute).toBe('OLVU1B OLVUK Y26 MARNI MARN2A')
    expect(result.errors).toEqual([])
    expect(result.departureRunway).toBe('03L')
    const parse = a.calls.find((u) => u.pathname.endsWith('/routes/parse'))
    expect(parse.searchParams.get('departure_runway')).toBe('03L')
    expect(parse.searchParams.get('arrival_runway')).toBe('36')
    expect(result.entryRoute).toBeNull()
  })
  it('accepts canonical names, lowercase runway inputs and speed/level suffixes', async () => {
    expect(normalizeRunway('rw3l')).toBe('03L')
    expect(normalizeRunway('RWY36')).toBe('36')
    expect(normalizeRunway('37')).toBeNull()
    const a = api()
    const result = await a.resolve({ ...request, route: 'N0444F360 OLVU1B OLVUK/N0440F340 Y26 MARNI MARNI2A/N0250F130' })
    expect(result.normalizedRoute).toBe('N0444F360 OLVU1B OLVUK/N0440F340 Y26 MARNI MARN2A/N0250F130')
  })
  it('handles a STAR-only route without treating it as the departure SID', async () => {
    const result = await api().resolve({ ...request, route: 'MARNI2A' })
    expect(result.normalizedRoute).toBe('MARN2A')
    expect(result.procedures).toHaveLength(1)
    expect(result.procedures[0].kind).toBe('STAR')
  })
  it('supports abbreviated input when the catalog stores the full endpoint name', async () => {
    const p = detail('VTSP', 'RADAR2A', 'STAR', 'RADAR', ['27'])
    const result = await api({ procedures: [p] }).resolve({ origin: 'VTBD', destination: 'VTSP', route: 'RADAR RADA2A', arrivalRunway: '27' })
    expect(result.normalizedRoute).toBe('RADAR RADAR2A')
  })
  it('paginates catalogs rather than assuming the first page contains every procedure', async () => {
    const a = api({ paginate: true, procedures: [detail('VTCC', 'ALFA1A', 'STAR', 'ALFAX', ['36']), ...procedures] })
    expect((await a.resolve(request)).normalizedRoute).toContain('MARN2A')
    expect(a.calls.some((u) => u.searchParams.get('airport') === 'VTCC' && u.searchParams.get('page') === '2')).toBe(true)
  })
  it('does not change revision, suffix, airport or a similar-looking endpoint', async () => {
    for (const route of ['OLVUK1B OLVUK Y26 MARNI MARNI3A', 'OLVUK1B OLVUK Y26 MARNI MARNI2B', 'OLVUK1B OLVUK Y26 MARNI MARNX2A']) {
      await expect(api().resolve({ ...request, route, entryFix: undefined })).rejects.toThrow(/not verified/)
    }
    await expect(api().resolve({ ...request, destination: 'VTSP', entryFix: undefined })).rejects.toThrow(/not verified/)
  })
  it('fails closed for colliding aliases instead of selecting the first match', async () => {
    const a = api({ procedures: [...procedures, detail('VTCC', 'MAR2A', 'STAR', 'MARNI', ['36'])] })
    await expect(a.resolve({ ...request, entryFix: undefined })).rejects.toThrow(/Ambiguous/)
    expect(a.calls.some((u) => u.pathname.endsWith('routes/parse'))).toBe(false)
  })
  it('never guesses a runway or substitutes a different runway variant', async () => {
    const multi = detail('VTBD', 'OLVU1B', 'SID', 'OLVUK', ['03L', '03R'])
    await expect(api({ procedures: [multi, procedures[1]] }).resolve({ ...request, entryFix: undefined })).rejects.toThrow(/Runway required/)
    await expect(api().resolve({ ...request, departureRunway: '21R', entryFix: undefined })).rejects.toThrow(/not supported/)
    expect((await api({ procedures: [multi, procedures[1]] }).resolve({ ...request, departureRunway: '03R' })).departureRunway).toBe('03R')
  })
  it('does not infer left/right from a parallel runway family', async () => {
    const p = detail('VTBS', 'NORT2C', 'STAR', 'NORTA', ['20B'])
    const r = { origin: 'VTBD', destination: 'VTBS', route: 'NORTA NORTA2C' }
    await expect(api({ procedures: [p] }).resolve(r)).rejects.toThrow(/Runway required/)
    expect((await api({ procedures: [p] }).resolve({ ...r, arrivalRunway: '20R' })).arrivalRunway).toBe('20R')
    await expect(api({ procedures: [p] }).resolve({ ...r, arrivalRunway: '19' })).rejects.toThrow(/not supported/)
  })
  it('keeps the independently verified enroute section when SID cannot be resolved', async () => {
    const a = api({ procedures: [procedures[1]] })
    const result = await a.resolve(request)
    expect(result.errors[0].scope).toBe('departure')
    expect(result.entryRoute.errors).toEqual([])
    expect(result.entryRoute.segments[0].from.identifier).toBe('OLVUK')
    expect(result.entryRoute.segments.at(-1).to.identifier).toBe('MARNI')
    expect(result.entryRoute.segments.some((s) => s.from.identifier === 'VTBD' || s.to.identifier === 'VTCC')).toBe(false)
    expect(a.calls.find((u) => u.pathname.endsWith('routes/parse')).searchParams.get('route')).toBe('OLVUK Y26 MARNI')
  })
  it('also isolates SID parser warnings after successful name/runway resolution', async () => {
    const a = api({ parse: (u) => routeData(undefined, u.searchParams.get('route').includes('OLVU1B')
      ? [{ type: 'procedure_no_segments', segment: 'OLVU1B', message: 'No segments' }] : []) })
    const result = await a.resolve(request)
    expect(result.errors).toHaveLength(1)
    expect(result.entryRoute.errors).toEqual([])
  })
  it('does not salvage an unresolved airway, missing entry, or malformed coordinates', async () => {
    const a = api({ parse: () => routeData(undefined, [{ type: 'airway_not_found', message: 'Y26 missing' }]) })
    const result = await a.resolve(request)
    expect(result.entryRoute).toBeNull()
    expect(result.entryRouteError).toMatch(/unresolved/)
    const bad = api({ parse: () => { const d = routeData(); d.segments[1].to.coordinates.lat = 91; return d } })
    expect((await bad.resolve(request)).entryRoute).toBeNull()
    const missing = api({ procedures: [procedures[1]] })
    await expect(missing.resolve({ ...request, route: 'OLVUK1B OLVUK Y26 MARNI2A' })).rejects.toThrow()
  })
  it('rejects a disconnected route even when the upstream parser reports no error', async () => {
    const a = api({ parse: () => { const d = routeData(); d.segments[2].from.coordinates.lat += .5; return d } })
    const result = await a.resolve(request)
    expect(result.errors.some((e) => e.type === 'route_discontinuity')).toBe(true)
    expect(result.entryRoute).toBeNull()
  })
  it('does not reuse geometry for a different explicitly selected runway', async () => {
    const a = api({ procedures: [detail('VTBD', 'OLVU1B', 'SID', 'OLVUK', ['03L', '03R']), procedures[1]] })
    await a.resolve({ ...request, departureRunway: '03L' })
    await a.resolve({ ...request, departureRunway: '03R' })
    expect(a.calls.filter((u) => u.pathname.endsWith('/routes/parse')).map((u) => u.searchParams.get('departure_runway'))).toEqual(['03L', '03R'])
  })
  it('scopes caches by cycle/runway, deduplicates requests and retries outages', async () => {
    const a = api()
    await Promise.all([a.resolve(request), a.resolve(request)])
    expect(a.calls.filter((u) => u.pathname.endsWith('/routes/parse'))).toHaveLength(1)
    await a.resolve(request)
    expect(a.calls.filter((u) => u.pathname.endsWith('/routes/parse'))).toHaveLength(1)
    let fail = true
    const b = api({ fail: (u) => fail && u.pathname.endsWith('/airac/current') })
    await expect(b.resolve(request)).rejects.toThrow(/outage/)
    fail = false
    expect((await b.resolve(request)).errors).toEqual([])
  })
  it('rejects mismatched AIRAC and discards previous-cycle cached geometry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T07:00:00Z'))
    let current = '2609'
    const a = api({ cycle: () => current })
    await a.resolve(request)
    current = '2610'; vi.advanceTimersByTime(61_000)
    await expect(a.resolve(request)).rejects.toThrow(/AIRAC mismatch/)
    await a.resolve({ ...request, cycle: '2610' })
    expect(a.calls.filter((u) => u.pathname.endsWith('/routes/parse'))).toHaveLength(2)
  })
  it('rejects mixed-cycle upstream responses', async () => {
    const a = api({ headerCycle: (u) => u.pathname.endsWith('/routes/parse') ? '2608' : '2609' })
    await expect(a.resolve(request)).rejects.toThrow(/AIRAC changed/)
  })
})

describe('filed STAR / active-runway mismatch planning', () => {
  const oldStar = { ...detail('VTBD', 'SABA3A', 'STAR', 'SABAI', ['21B']),
    transitions: { HOTEL: [{ ...leg('HOTEL'), path_terminator: 'IF' }, leg('SABAI')] } }
  const newStar = detail('VTBD', 'SABA3B', 'STAR', 'SABAI', ['03B'])
  const input = { origin: 'VTST', destination: 'VTBD', route: 'TRN Y99 HOTEL SABAI3A', arrivalRunway: '03L', entryFix: 'SABAI' }
  const parse = () => routeData(['VTST', 'TRN', 'HOTEL', 'SABAI', 'VTBD'])
  it('recovers only the published feeder, preserves filed STAR and labels one compatible replacement EST', async () => {
    const a = api({ procedures: [oldStar, newStar], parse }), result = await a.resolve(input)
    expect(result.normalizedRoute).toBe(input.route)
    expect(result.arrivalSelection).toMatchObject({ status: 'ESTIMATED', selected: 'SABA3B', filed: 'SABAI3A', runway: '03L', cycle })
    expect(result.arrivalSelection.reason).toContain('NOT A CLEARANCE')
    expect(result.errors[0].message).toContain('not supported')
    expect(result.entryRoute.errors).toEqual([])
    expect(result.entryRoute.segments.at(-1).to.identifier).toBe('SABAI')
    expect(result.entryRouteSource).toBe('FILED_STAR_TRANSITION')
    const requests = a.calls.filter(u => u.pathname.endsWith('/routes/parse'))
    expect(requests.map(u => u.searchParams.get('route'))).toEqual(['TRN Y99 HOTEL SABAI'])
    expect(requests[0].searchParams.has('arrival_runway')).toBe(false)
  })
  it('keeps explicit entry ETA when several compatible STARs exist, but selects none', async () => {
    const a = api({ procedures: [oldStar, newStar, { ...newStar, identifier: 'SABA3C' }], parse })
    const result = await a.resolve({ ...input, route: 'TRN Y99 HOTEL DCT SABAI SABAI3A' })
    expect(result.arrivalSelection).toMatchObject({ status: 'REQUIRED', selected: null, candidates: ['SABA3B', 'SABA3C'] })
    expect(result.entryRoute).not.toBeNull()
    const manual = await a.resolve({ ...input, selectedStar: 'SABA3C' })
    expect(manual.arrivalSelection).toMatchObject({ status: 'MANUAL_ESTIMATE', selected: 'SABA3C' })
    expect((await a.resolve({ ...input, selectedStar: 'WRONG1A' })).arrivalSelection.selected).toBeNull()
  })
  it('does not substitute different entries, airports, runway sides, revisions or unavailable catalogs', async () => {
    const cases = [detail('VTBD', 'DOTL3B', 'STAR', 'DOTLI', ['03B']),
      detail('VTBS', 'SABA3B', 'STAR', 'SABAI', ['03B']), detail('VTBD', 'SABA3B', 'STAR', 'SABAI', ['03R'])]
    const result = await api({ procedures: [oldStar, ...cases], parse }).resolve(input)
    expect(result.arrivalSelection).toMatchObject({ status: 'REQUIRED', selected: null, candidates: [] })
    const failure = await api({ procedures: [oldStar, newStar], parse,
      fail: u => u.pathname.endsWith('/SABA3B') }).resolve(input)
    expect(failure.arrivalSelection.status).toBe('REQUIRED')
    expect(failure.arrivalSelection.reason).toContain('Catalog unavailable')
    expect(failure.entryRoute).not.toBeNull()
    await expect(api({ procedures: [oldStar, newStar], parse }).resolve({ ...input, route: 'TRN Y99 HOTEL SABAI9Z' })).rejects.toThrow('not verified')
  })
  it('does not bridge unknown trailing fixes, unsupported feeder legs or guessed entry names', async () => {
    for (const route of ['TRN Y99 HOTEL UNKNOWN SABAI3A', 'TRN Y99 HOTEL OTHER SABAI3A']) {
      const result = await api({ procedures: [oldStar, newStar], parse }).resolve({ ...input, route })
      expect(result.entryRoute).toBeNull()
    }
    const vector = { ...oldStar, transitions: { HOTEL: [leg('HOTEL'), { ...leg('SABAI'), path_terminator: 'VM' }] } }
    expect((await api({ procedures: [vector, newStar], parse }).resolve(input)).entryRoute).toBeNull()
    const wrongEntry = await api({ procedures: [oldStar, newStar], parse }).resolve({ ...input, entryFix: 'DOTLI' })
    expect(wrongEntry.arrivalSelection.selected).toBeNull()
    expect(wrongEntry.entryRoute).toBeNull()
  })
  it('expands the verified STAR entry after an airway, but still rejects unresolved airway geometry', async () => {
    const input = { origin: 'VTBD', destination: 'VTCC', route: 'OLVUK Y26 MARNI2A', arrivalRunway: '18', entryFix: 'MARNI' }
    const defs = [procedures[1], detail('VTCC', 'MARN2B', 'STAR', 'MARNI', ['18'])]
    const a = api({ procedures: defs })
    const result = await a.resolve(input)
    expect(result.entryRoute.segments.at(-1).to.identifier).toBe('MARNI')
    expect(a.calls.find(u => u.pathname.endsWith('/routes/parse')).searchParams.get('route')).toBe('OLVUK Y26 MARNI')
    const bad = await api({ procedures: defs, parse: () => routeData(undefined, [{ type: 'airway_not_found', message: 'Y26 missing' }]) }).resolve(input)
    expect(bad.entryRoute).toBeNull()
  })
  it.each([
    ['VTBD', '21B', '03L'], ['VTBS', '20B', '02R'], ['VTCC', '36', '18'], ['VTSP', '27', '09'],
  ])('%s applies the same explicit-entry policy without airport-specific STAR names', async (airport, oldRunway, runway) => {
    const a = api({ procedures: [detail(airport, 'ENTRY1A', 'STAR', 'ENTRY', [oldRunway]),
      detail(airport, 'ENTRY1B', 'STAR', 'ENTRY', [runway])], parse: () => routeData(['VTST', 'START', 'ENTRY', airport]) })
    const result = await a.resolve({ origin: 'VTST', destination: airport, route: 'START DCT ENTRY ENTRY1A', arrivalRunway: runway, entryFix: 'ENTRY' })
    expect(result.arrivalSelection.selected).toBe('ENTRY1B')
    expect(result.entryRoute.segments.at(-1).to.identifier).toBe('ENTRY')
  })
})

describe('all source STAR names, not a MARNI special case', () => {
  for (const airport of Object.values(bundle.airports)) {
    for (const p of airport.procedures.filter((p) => p.kind === 'STAR')) {
      it(`${airport.code} ${p.name} / ${p.runway}: canonical and endpoint alias`, async () => {
        const entry = p.legs[0].fix, suffix = p.name.match(/\d[A-Z]$/)?.[0]
        const a = api({ procedures: [detail(airport.code, p.name, 'STAR', entry, [p.runway])] })
        for (const name of new Set([p.name, suffix && entry.startsWith(p.name.slice(0, -suffix.length)) ? `${entry}${suffix}` : p.name])) {
          const result = await a.resolve({ origin: 'VTBD', destination: airport.code, route: `${entry} ${name}`, arrivalRunway: p.runway })
          expect(result.normalizedRoute).toBe(`${entry} ${p.name}`)
        }
      })
    }
  }
  it.each([
    ['VTCC', 'LIBI2A', 'LIBIN', '18'], ['VTSP', 'KREN1B', 'KRENS', '27'],
    ['VTBS', 'GOST3C', 'GOSTO', '19'], ['EGLL', 'LAM6M', 'LAM', '27R'],
  ])('uses the same SID rules at %s (synthetic fixtures)', async (airport, id, exit, rwy) => {
    const a = api({ procedures: [detail(airport, id, 'SID', exit, [rwy])] })
    const alias = exit + id.match(/\d[A-Z]$/)[0]
    const result = await a.resolve({ origin: airport, destination: 'VTBD', route: `${alias} ${exit} DCT FINAL` })
    expect(result.normalizedRoute).toBe(`${id} ${exit} DCT FINAL`)
    expect(result.departureRunway).toBe(rwy)
  })
})

describe('route API validation', () => {
  it.each([{ arrivalRunway: 'https://evil.test' }, { departureRunway: '37' }, { cycle: 'latest' }, { entryFix: 'MARNI&evil' }, { route: 'X'.repeat(2001) }])('rejects invalid optional fields %j', async (extra) => {
    const response = await onRequestPost({ request: new Request('https://example.test/api/sequence/route-geometry', { method: 'POST', body: JSON.stringify({ ...request, ...extra }) }) })
    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('DCT and published feeder extensions', () => {
  it('resolves the reported filed STAR with 21R without looking up a waypoint called DCT', async () => {
    const a = api({ procedures: [detail('VTBD', 'SABA3A', 'STAR', 'SABAI', ['21L', '21R'])],
      parse: u => {
        expect(u.searchParams.get('route')).toBe('TRN W24 BITEN Y99 HOTEL SABAI SABA3A')
        expect(u.searchParams.get('arrival_runway')).toBe('21R')
        return routeData(['VTST', 'TRN', 'BITEN', 'HOTEL', 'SABAI', 'VTBD'])
      } })
    const result = await a.resolve({ origin: 'VTST', destination: 'VTBD',
      route: 'DCT TRN W24 BITEN Y99 HOTEL DCT SABAI SABAI3A', entryFix: 'SABAI', arrivalRunway: '21R' })
    expect(result.errors).toEqual([])
    expect(result.entryRouteSource).toBe('FILED')
    expect(result.normalizedRoute).toContain('HOTEL DCT SABAI SABA3A')
  })

  for (const [destination, entries] of Object.entries(transitions.airports)) {
    for (const [via, path] of Object.entries(entries)) {
      it(`${destination}: ${via} connects via every published fix to ${path.at(-1)}`, async () => {
        const a = api({ parse: u => {
          expect(u.searchParams.get('route')).toBe([via, ...path].join(' '))
          return routeData(['VTSM', via, ...path, destination])
        } })
        const result = await a.resolve({ origin: 'VTSM', destination, route: via, entryFix: path.at(-1) })
        expect(result.errors).toEqual([])
        expect(result.entryRouteSource).toBe('AIP_INFERRED')
        expect(result.entryTransition).toMatchObject({ via, path })
        expect(result.procedures).toEqual([]) // no invented STAR/clearance
      })
    }
  }
  it('supports a terminal airport and level suffix without modifying the filed route', () => {
    expect(arrivalEntryExtension('VTBD', 'TRN Y99 HOTEL/N0250F150 VTBD', 'SABAI')?.route)
      .toBe('TRN Y99 HOTEL/N0250F150 DCT SABAI')
  })
  it.each(['HOTEL DCT UNKNOWN', 'HOTEL SABAI9X', 'HOTEL Y99', 'HOTEL DCT WEHHA'])('does not overwrite later filed instructions: %s', route => {
    expect(arrivalEntryExtension('VTBD', route, 'SABAI')).toBeNull()
  })
  it('never maps a feeder from the other airport or duplicates an already filed entry', () => {
    expect(arrivalEntryExtension('VTBS', 'HOTEL', 'SABAI')).toBeNull()
    expect(arrivalEntryExtension('VTCC', 'HOTEL', 'SABAI')).toBeNull()
    expect(arrivalEntryExtension('VTBD', 'HOTEL DCT SABAI', 'SABAI')).toBeNull()
  })
  it('rejects a missing intermediate feeder fix even if upstream reports success', async () => {
    const r = await api({ parse: () => routeData(['VTSM', 'ANREN', 'TUMGA', 'VTBS']) })
      .resolve({ origin: 'VTSM', destination: 'VTBS', route: 'ANREN', entryFix: 'TUMGA' })
    expect(r.errors.some(e => e.type === 'direct_leg_missing')).toBe(true)
    expect(r.entryRoute).toBeNull()
  })
  it('does not silently accept a complete airport route that never reaches the requested entry', async () => {
    const r = await api({ parse: () => routeData(['VTSM', 'UNKNOWN', 'VTBD']) })
      .resolve({ origin: 'VTSM', destination: 'VTBD', route: 'UNKNOWN', entryFix: 'SABAI' })
    expect(r.errors.some(e => e.type === 'entry_not_on_route')).toBe(true)
    expect(r.entryRoute).toBeNull()
  })
  it('still rejects unresolved fixes and airways alongside DCT', async () => {
    const r = await api({ parse: () => routeData(['VTST', 'TRN', 'HOTEL', 'SABAI', 'VTBD'],
      [{ type: 'airway_not_found', segment: 'Y9999', message: 'Unknown airway' }]) })
      .resolve({ origin: 'VTST', destination: 'VTBD', route: 'TRN Y9999 HOTEL DCT SABAI', entryFix: 'SABAI' })
    expect(r.errors.some(e => e.type === 'airway_not_found')).toBe(true)
    expect(r.entryRoute).toBeNull()
  })
})
