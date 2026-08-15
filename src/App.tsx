import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { ensureAnonymousSession, isSupabaseConfigured, supabase } from './lib/supabase'
import type { ArrivalStatus, ArrivalView, FixTiming, SequenceSession } from './types'

const AIRPORT = 'VTBD' as const
const FLOW = '21'
const DEFAULT_RUNWAY_CONFIG = '21L / 21R'

const timeOnly = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

const intervalLabel = (value: string | null | undefined) => {
  if (!value) return '—'
  const sign = value.startsWith('-') ? '-' : value === '00:00:00' ? '' : '+'
  const clean = value.replace(/^-/, '')
  const match = clean.match(/(?:(\d+) days? )?(\d{2}):(\d{2}):/)
  if (!match) return value
  const days = Number(match[1] ?? 0)
  const hours = Number(match[2]) + days * 24
  return `${sign}${String(hours).padStart(2, '0')}:${match[3]}`
}

const isoFromClock = (serviceDate: string, hhmm: string, anchor?: string | null) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const candidate = new Date(`${serviceDate}T00:00:00.000Z`)
  candidate.setUTCHours(hours, minutes, 0, 0)

  if (anchor) {
    const anchorDate = new Date(anchor)
    const delta = candidate.getTime() - anchorDate.getTime()
    if (delta < -12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() + 1)
    if (delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  }

  return candidate.toISOString()
}

const averageInterval = (rows: ArrivalView[]) => {
  const times = rows
    .filter((row) => row.status !== 'CANCELLED')
    .map((row) => new Date(row.cldt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)

  if (times.length < 2) return '—'
  const gaps = times.slice(1).map((time, index) => time - times[index])
  const averageMs = gaps.reduce((sum, value) => sum + value, 0) / gaps.length
  const totalSeconds = Math.max(0, Math.round(averageMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

type EditingState = Record<string, { userId: string; displayName: string }>

function SetupRequired() {
  return (
    <div className="setup-shell">
      <div className="setup-card">
        <div className="setup-icon">✈</div>
        <div className="eyebrow">ARRIVAL SEQUENCING</div>
        <h1>Supabase connection required</h1>
        <p>The application code is ready. Add the two Vite environment variables to connect the shared realtime database.</p>
        <pre>VITE_SUPABASE_URL=...{`\n`}VITE_SUPABASE_PUBLISHABLE_KEY=...</pre>
        <p className="muted">Do not use a secret/service-role key in the browser.</p>
      </div>
    </div>
  )
}

function App() {
  const [session, setSession] = useState<SequenceSession | null>(null)
  const [arrivals, setArrivals] = useState<ArrivalView[]>([])
  const [fixes, setFixes] = useState<FixTiming[]>([])
  const [profileName, setProfileName] = useState('Controller')
  const [onlineControllers, setOnlineControllers] = useState<string[]>([])
  const [editing, setEditing] = useState<EditingState>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingCell, setSavingCell] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const userIdRef = useRef<string | null>(null)

  const refreshArrivals = async (sessionId: string) => {
    if (!supabase) return
    const { data, error: queryError } = await supabase
      .from('arrival_sequence_view')
      .select('*')
      .eq('session_id', sessionId)
      .order('sequence_no', { ascending: true })
      .order('cldt', { ascending: true })

    if (queryError) throw queryError
    setArrivals((data ?? []) as ArrivalView[])
  }

  const loadFixes = async (activeSession: SequenceSession) => {
    if (!supabase) return
    const { data, error: queryError } = await supabase
      .from('fix_timings')
      .select('*')
      .eq('airport', activeSession.airport)
      .eq('flow', activeSession.flow)
      .eq('active', true)
      .lte('effective_from', activeSession.service_date)
      .order('effective_from', { ascending: false })

    if (queryError) throw queryError

    const byFix = new Map<string, FixTiming>()
    for (const row of (data ?? []) as FixTiming[]) {
      if (row.effective_to && row.effective_to < activeSession.service_date) continue
      if (!byFix.has(row.fix)) byFix.set(row.fix, row)
    }
    setFixes([...byFix.values()].sort((a, b) => a.fix.localeCompare(b.fix)))
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false)
      return
    }

    let disposed = false
    const client = supabase

    const bootstrap = async () => {
      try {
        setLoading(true)
        setError(null)
        const authSession = await ensureAnonymousSession()
        const userId = authSession.user.id
        userIdRef.current = userId

        const { data: profile, error: profileError } = await client
          .from('controller_profiles')
          .select('display_name')
          .eq('user_id', userId)
          .single()
        if (profileError) throw profileError
        const displayName = profile.display_name as string
        if (!disposed) setProfileName(displayName)

        const todayUtc = new Date().toISOString().slice(0, 10)
        const { data: existingSession, error: sessionQueryError } = await client
          .from('sequence_sessions')
          .select('*')
          .eq('airport', AIRPORT)
          .eq('flow', FLOW)
          .eq('service_date', todayUtc)
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (sessionQueryError) throw sessionQueryError

        let activeSession = existingSession as SequenceSession | null
        if (!activeSession) {
          const { data: createdSession, error: createSessionError } = await client
            .from('sequence_sessions')
            .insert({
              airport: AIRPORT,
              flow: FLOW,
              runway_config: DEFAULT_RUNWAY_CONFIG,
              service_date: todayUtc,
              status: 'ACTIVE',
              created_by: userId,
            })
            .select('*')
            .single()
          if (createSessionError) throw createSessionError
          activeSession = createdSession as SequenceSession
        }

        if (disposed || !activeSession) return
        setSession(activeSession)
        await Promise.all([refreshArrivals(activeSession.id), loadFixes(activeSession)])

        const realtimeChannel = client.channel(`sequence:${activeSession.id}`, {
          config: { presence: { key: userId } },
        })

        realtimeChannel
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'arrivals',
              filter: `session_id=eq.${activeSession.id}`,
            },
            () => void refreshArrivals(activeSession!.id).catch((err) => setError(err.message)),
          )
          .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState<{ displayName: string }>()
            const names = Object.values(state)
              .flat()
              .map((presence) => presence.displayName)
              .filter(Boolean)
            setOnlineControllers([...new Set(names)])
          })
          .on('broadcast', { event: 'editing' }, ({ payload }) => {
            if (!payload || payload.userId === userId) return
            const key = `${payload.arrivalId}:${payload.field}`
            setEditing((current) => ({
              ...current,
              [key]: { userId: payload.userId, displayName: payload.displayName },
            }))
          })
          .on('broadcast', { event: 'editing-end' }, ({ payload }) => {
            if (!payload) return
            const key = `${payload.arrivalId}:${payload.field}`
            setEditing((current) => {
              const next = { ...current }
              delete next[key]
              return next
            })
          })
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await realtimeChannel.track({ displayName, onlineAt: new Date().toISOString() })
            }
          })

        channelRef.current = realtimeChannel
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      if (channelRef.current) void client.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [])

  const visibleArrivals = useMemo(() => {
    const needle = search.trim().toUpperCase()
    if (!needle) return arrivals
    return arrivals.filter((row) =>
      [row.callsign, row.aircraft_type, row.departure, row.ref_fix]
        .filter(Boolean)
        .some((value) => value!.toUpperCase().includes(needle)),
    )
  }, [arrivals, search])

  const nextLanding = useMemo(
    () => arrivals
      .filter((row) => !['LANDED', 'CANCELLED'].includes(row.status))
      .sort((a, b) => new Date(a.cldt).getTime() - new Date(b.cldt).getTime())[0] ?? null,
    [arrivals],
  )

  const startEditing = (arrivalId: string, field: string) => {
    const channel = channelRef.current
    if (!channel || !userIdRef.current) return
    void channel.send({
      type: 'broadcast',
      event: 'editing',
      payload: { arrivalId, field, userId: userIdRef.current, displayName: profileName },
    })
  }

  const stopEditing = (arrivalId: string, field: string) => {
    const channel = channelRef.current
    if (!channel || !userIdRef.current) return
    void channel.send({
      type: 'broadcast',
      event: 'editing-end',
      payload: { arrivalId, field, userId: userIdRef.current },
    })
  }

  const updateArrival = async (row: ArrivalView, field: string, value: string | null) => {
    if (!supabase || !session) return
    const cellKey = `${row.id}:${field}`
    setSavingCell(cellKey)
    setError(null)

    try {
      let dbValue: string | null = value
      if (field === 'eto' && value) dbValue = isoFromClock(session.service_date, value)
      if (field === 'cldt' && value) dbValue = isoFromClock(session.service_date, value, row.eto)
      if (field === 'aldt') dbValue = value ? isoFromClock(session.service_date, value, row.cldt) : null

      const { error: updateError } = await supabase
        .from('arrivals')
        .update({ [field]: dbValue })
        .eq('id', row.id)
      if (updateError) throw updateError
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingCell(null)
      stopEditing(row.id, field)
    }
  }

  const addFlight = async () => {
    if (!supabase || !session || fixes.length === 0) return
    try {
      setError(null)
      const now = new Date()
      const serviceDate = session.service_date
      const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
      const sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
      const { error: insertError } = await supabase.from('arrivals').insert({
        session_id: session.id,
        sequence_no: sequenceNo,
        callsign: 'NEW',
        aircraft_type: null,
        departure: null,
        ref_fix: fixes[0].fix,
        eto: isoFromClock(serviceDate, hhmm),
        status: 'INBOUND',
      })
      if (insertError) throw insertError
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const deleteFlight = async (row: ArrivalView) => {
    if (!supabase) return
    if (!window.confirm(`Delete ${row.callsign}?`)) return
    const { error: deleteError } = await supabase.from('arrivals').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
  }

  const saveProfileName = async () => {
    if (!supabase || !userIdRef.current) return
    const clean = profileName.trim() || 'Controller'
    setProfileName(clean)
    const { error: profileError } = await supabase
      .from('controller_profiles')
      .update({ display_name: clean })
      .eq('user_id', userIdRef.current)
    if (profileError) setError(profileError.message)
  }

  if (!isSupabaseConfigured) return <SetupRequired />

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">✈</div>
          <div>
            <div className="eyebrow">THAILAND APPROACH TOOLS</div>
            <h1>VTBD Arrival Sequencing</h1>
            <p>Flow {FLOW} · Shared realtime workspace</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="connection-pill"><span className="live-dot" /> REALTIME</div>
          <div className="controller-stack">
            <span>{onlineControllers.length || 1} online</span>
            <div className="avatar-row">
              {onlineControllers.slice(0, 4).map((name) => <i key={name} title={name}>{name.slice(0, 2).toUpperCase()}</i>)}
            </div>
          </div>
          <input
            className="controller-name"
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            onBlur={() => void saveProfileName()}
            aria-label="Controller display name"
          />
          <button className="primary-button" onClick={() => void addFlight()} disabled={!session || fixes.length === 0}>+ Add Flight</button>
        </div>
      </header>

      <main className="content">
        {error && <div className="error-banner"><strong>Database:</strong> {error}</div>}
        {loading && <div className="loading-bar">Connecting to shared sequence…</div>}

        <section className="summary-grid">
          <article className="summary-card"><span>Flights in sequence</span><strong>{arrivals.length}</strong><small>Shared rows</small></article>
          <article className="summary-card"><span>Next landing (CLDT)</span><strong>{nextLanding ? timeOnly(nextLanding.cldt) : '—'}</strong><small>{nextLanding?.callsign ?? 'No inbound traffic'}</small></article>
          <article className="summary-card"><span>Average interval</span><strong>{averageInterval(arrivals)}</strong><small>Calculated from CLDT</small></article>
          <article className="summary-card"><span>Controllers online</span><strong>{onlineControllers.length || 1}</strong><small>Presence channel</small></article>
        </section>

        <section className="workspace-card">
          <div className="workspace-toolbar">
            <div>
              <div className="section-kicker">{AIRPORT} · FLOW {FLOW} · {session?.runway_config ?? DEFAULT_RUNWAY_CONFIG}</div>
              <h2>Arrival sequence</h2>
              <p>Type directly into editable cells. Changes save automatically and appear on every connected screen.</p>
            </div>
            <div className="toolbar-controls">
              <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search flights" placeholder="Search callsign, aircraft or fix…" />
              <button className="secondary-button" onClick={() => session && void refreshArrivals(session.id)}>↻ Refresh</button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SEQ</th><th>CALLSIGN</th><th>A/C</th><th>DEP</th><th>REF FIX</th><th>ETO</th><th>ELDT</th><th>CLDT</th><th>CTO</th><th>ALDT</th><th>SEQ VAR</th><th>STATUS</th><th />
                </tr>
              </thead>
              <tbody>
                {visibleArrivals.map((row) => {
                  const editableOwner = (field: string) => editing[`${row.id}:${field}`]
                  const cellClass = (field: string, extra = '') => {
                    const key = `${row.id}:${field}`
                    return `editable-cell ${savingCell === key ? 'saving-cell' : ''} ${editableOwner(field) ? 'remote-editing' : ''} ${extra}`
                  }

                  return (
                    <tr key={row.id} className={row.status === 'SEQUENCED' ? 'active-row' : ''}>
                      <td className="seq-cell">{row.sequence_no}</td>
                      <td className={cellClass('callsign')} data-editor={editableOwner('callsign')?.displayName}>
                        <input defaultValue={row.callsign} onFocus={() => startEditing(row.id, 'callsign')} onBlur={(e) => void updateArrival(row, 'callsign', e.target.value)} />
                      </td>
                      <td className={cellClass('aircraft_type')} data-editor={editableOwner('aircraft_type')?.displayName}>
                        <input defaultValue={row.aircraft_type ?? ''} onFocus={() => startEditing(row.id, 'aircraft_type')} onBlur={(e) => void updateArrival(row, 'aircraft_type', e.target.value)} />
                      </td>
                      <td className={cellClass('departure')} data-editor={editableOwner('departure')?.displayName}>
                        <input defaultValue={row.departure ?? ''} onFocus={() => startEditing(row.id, 'departure')} onBlur={(e) => void updateArrival(row, 'departure', e.target.value)} />
                      </td>
                      <td className={cellClass('ref_fix')} data-editor={editableOwner('ref_fix')?.displayName}>
                        <select value={row.ref_fix} onFocus={() => startEditing(row.id, 'ref_fix')} onBlur={() => stopEditing(row.id, 'ref_fix')} onChange={(e) => void updateArrival(row, 'ref_fix', e.target.value)}>
                          {fixes.map((fix) => <option key={fix.id} value={fix.fix}>{fix.fix}{fix.verified ? '' : ' *'}</option>)}
                        </select>
                      </td>
                      <td className={cellClass('eto')} data-editor={editableOwner('eto')?.displayName}>
                        <input type="time" defaultValue={timeOnly(row.eto)} onFocus={() => startEditing(row.id, 'eto')} onBlur={(e) => void updateArrival(row, 'eto', e.target.value)} />
                      </td>
                      <td className="computed-cell">{timeOnly(row.eldt)}</td>
                      <td className={cellClass('cldt', 'cldt-cell')} data-editor={editableOwner('cldt')?.displayName}>
                        <input type="time" defaultValue={timeOnly(row.cldt)} onFocus={() => startEditing(row.id, 'cldt')} onBlur={(e) => void updateArrival(row, 'cldt', e.target.value)} />
                      </td>
                      <td className="computed-cell">{timeOnly(row.cto)}</td>
                      <td className={cellClass('aldt')} data-editor={editableOwner('aldt')?.displayName}>
                        <input type="time" defaultValue={row.aldt ? timeOnly(row.aldt) : ''} onFocus={() => startEditing(row.id, 'aldt')} onBlur={(e) => void updateArrival(row, 'aldt', e.target.value || null)} />
                      </td>
                      <td className={row.seq_var?.startsWith('-') ? 'negative-var' : row.seq_var ? 'positive-var' : ''}>{intervalLabel(row.seq_var)}</td>
                      <td>
                        <select className={`status-select status-${row.status.toLowerCase()}`} value={row.status} onChange={(e) => void updateArrival(row, 'status', e.target.value as ArrivalStatus)}>
                          <option value="INBOUND">INBOUND</option>
                          <option value="SEQUENCED">SEQUENCED</option>
                          <option value="LANDING">LANDING</option>
                          <option value="LANDED">LANDED</option>
                          <option value="CANCELLED">CANCELLED</option>
                        </select>
                      </td>
                      <td><button className="row-menu" onClick={() => void deleteFlight(row)} title={`Delete ${row.callsign}`}>×</button></td>
                    </tr>
                  )
                })}
                {!loading && visibleArrivals.length === 0 && (
                  <tr><td colSpan={13} className="empty-state">No flights yet. Click <strong>+ Add Flight</strong> to create the first shared row.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className="workspace-footer">
            <div className="legend">
              <span><i className="dot editable-dot" /> Editable / autosave</span>
              <span><i className="dot computed-dot" /> Auto: ELDT & CTO</span>
              <span><i className="dot provisional-dot" /> * provisional timing</span>
            </div>
            <div>{session ? `Session ${session.service_date}` : 'Connecting…'} · <strong className="live">● LIVE</strong></div>
          </footer>
        </section>
      </main>
    </div>
  )
}

export default App
