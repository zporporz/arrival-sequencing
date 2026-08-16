import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getBrowserIdentity, saveBrowserDisplayName } from './browserIdentity'
import { supabase } from './lib/supabase'
import type { ArrivalStatus, ArrivalView, FixTiming, SequenceSession } from './types'

const AIRPORT = 'VTBD' as const
const requestedFlow = new URLSearchParams(window.location.search).get('flow')
const FLOW = requestedFlow === '03' ? '03' : '21'
const DEFAULT_RUNWAY_CONFIG = FLOW === '03' ? '03L / 03R' : '21L / 21R'

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

const formatAtcTimeDraft = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

const isValidAtcTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)

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

const sameInstant = (left: string, right: string) => {
  const leftTime = new Date(left).getTime()
  const rightTime = new Date(right).getTime()
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && Math.abs(leftTime - rightTime) < 1000
}

const sortArrivalRows = (rows: ArrivalView[]) => [...rows].sort((left, right) => {
  const sequenceDelta = left.sequence_no - right.sequence_no
  if (sequenceDelta !== 0) return sequenceDelta
  return new Date(left.cldt).getTime() - new Date(right.cldt).getTime()
})

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
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

type EditingState = Record<string, { displayName: string }>

function App() {
  const identity = useMemo(() => getBrowserIdentity(), [])
  const [session, setSession] = useState<SequenceSession | null>(null)
  const [arrivals, setArrivals] = useState<ArrivalView[]>([])
  const [fixes, setFixes] = useState<FixTiming[]>([])
  const [profileName, setProfileName] = useState(identity.displayName)
  const [onlineControllers, setOnlineControllers] = useState<string[]>([])
  const [editing, setEditing] = useState<EditingState>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingCell, setSavingCell] = useState<string | null>(null)
  const [utcNow, setUtcNow] = useState(new Date())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const profileNameRef = useRef(profileName)
  const realtimePendingIdsRef = useRef<Set<string>>(new Set())
  const realtimeFlushTimerRef = useRef<number | null>(null)

  const refreshArrivals = useCallback(async (sessionId: string) => {
    const { data, error: queryError } = await supabase
      .from('arrival_sequence_view')
      .select('*')
      .eq('session_id', sessionId)
      .order('sequence_no', { ascending: true })
      .order('cldt', { ascending: true })

    if (queryError) throw queryError
    setArrivals((data ?? []) as ArrivalView[])
  }, [])

  const syncArrivalRows = useCallback(async (arrivalIds: string[]) => {
    const uniqueIds = [...new Set(arrivalIds)]
    if (uniqueIds.length === 0) return

    const { data, error: queryError } = await supabase
      .from('arrival_sequence_view')
      .select('*')
      .in('id', uniqueIds)

    if (queryError) throw queryError
    const incoming = (data ?? []) as ArrivalView[]

    setArrivals((current) => {
      const byId = new Map(current.map((row) => [row.id, row]))
      for (const row of incoming) byId.set(row.id, row)
      return sortArrivalRows([...byId.values()])
    })
  }, [])

  const queueArrivalSync = useCallback((arrivalId: string) => {
    realtimePendingIdsRef.current.add(arrivalId)
    if (realtimeFlushTimerRef.current !== null) return

    realtimeFlushTimerRef.current = window.setTimeout(() => {
      const ids = [...realtimePendingIdsRef.current]
      realtimePendingIdsRef.current.clear()
      realtimeFlushTimerRef.current = null
      void syncArrivalRows(ids).catch((err: Error) => setError(err.message))
    }, 75)
  }, [syncArrivalRows])

  const loadFixes = useCallback(async (activeSession: SequenceSession) => {
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
  }, [])

  useEffect(() => {
    profileNameRef.current = profileName
  }, [profileName])

  useEffect(() => {
    const timer = window.setInterval(() => setUtcNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let disposed = false

    const bootstrap = async () => {
      try {
        setLoading(true)
        setError(null)
        const todayUtc = new Date().toISOString().slice(0, 10)

        const { data: existingSession, error: sessionQueryError } = await supabase
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
          const { data: createdSession, error: createSessionError } = await supabase
            .from('sequence_sessions')
            .insert({
              airport: AIRPORT,
              flow: FLOW,
              runway_config: DEFAULT_RUNWAY_CONFIG,
              service_date: todayUtc,
              status: 'ACTIVE',
            })
            .select('*')
            .single()
          if (createSessionError) throw createSessionError
          activeSession = createdSession as SequenceSession
        }

        if (disposed || !activeSession) return
        setSession(activeSession)
        await Promise.all([refreshArrivals(activeSession.id), loadFixes(activeSession)])

        const realtimeChannel = supabase.channel(`sequence:${activeSession.id}`, {
          config: { presence: { key: identity.id } },
        })

        realtimeChannel
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'arrivals',
              filter: `session_id=eq.${activeSession.id}`,
            },
            ({ new: newRow }) => {
              const arrivalId = (newRow as { id?: string }).id
              if (arrivalId) queueArrivalSync(arrivalId)
            },
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'arrivals',
              filter: `session_id=eq.${activeSession.id}`,
            },
            ({ new: newRow }) => {
              const arrivalId = (newRow as { id?: string }).id
              if (arrivalId) queueArrivalSync(arrivalId)
            },
          )
          .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'arrivals' },
            ({ old: oldRow }) => {
              const arrivalId = (oldRow as { id?: string }).id
              if (!arrivalId) return
              realtimePendingIdsRef.current.delete(arrivalId)
              setArrivals((current) => current.filter((row) => row.id !== arrivalId))
            },
          )
          .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState<{ displayName?: string }>()
            const names = Object.values(state)
              .flat()
              .map((presence) => presence.displayName)
              .filter((name): name is string => Boolean(name))
            setOnlineControllers([...new Set(names)])
          })
          .on('broadcast', { event: 'editing' }, ({ payload }) => {
            if (!payload || payload.userId === identity.id) return
            const key = `${payload.arrivalId}:${payload.field}`
            setEditing((current) => ({ ...current, [key]: { displayName: payload.displayName } }))
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
              await realtimeChannel.track({ displayName: profileNameRef.current, onlineAt: new Date().toISOString() })
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
      if (realtimeFlushTimerRef.current !== null) {
        window.clearTimeout(realtimeFlushTimerRef.current)
        realtimeFlushTimerRef.current = null
      }
      realtimePendingIdsRef.current.clear()
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [identity.id, loadFixes, queueArrivalSync, refreshArrivals])

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
    if (!channel) return
    void channel.send({
      type: 'broadcast',
      event: 'editing',
      payload: { arrivalId, field, userId: identity.id, displayName: profileName },
    })
  }

  const stopEditing = (arrivalId: string, field: string) => {
    const channel = channelRef.current
    if (!channel) return
    void channel.send({
      type: 'broadcast',
      event: 'editing-end',
      payload: { arrivalId, field, userId: identity.id },
    })
  }

  const updateArrival = async (row: ArrivalView, field: string, value: string | null) => {
    if (!session) return
    const cellKey = `${row.id}:${field}`
    setSavingCell(cellKey)
    setError(null)

    try {
      let dbValue: string | null = value
      if (field === 'eto' && value) dbValue = isoFromClock(session.service_date, value, row.eto)
      if (field === 'cldt' && value) dbValue = isoFromClock(session.service_date, value, row.eto)
      if (field === 'aldt') dbValue = value ? isoFromClock(session.service_date, value, row.cldt) : null

      const patch: Record<string, string | null> = { [field]: dbValue }

      const { error: updateError } = await supabase.from('arrivals').update(patch).eq('id', row.id)
      if (updateError) throw updateError
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingCell(null)
      stopEditing(row.id, field)
    }
  }

  const resetCldt = async (row: ArrivalView) => {
    const cellKey = `${row.id}:cldt`
    setSavingCell(cellKey)
    setError(null)
    try {
      const { error: updateError } = await supabase
        .from('arrivals')
        .update({ cldt: row.eldt })
        .eq('id', row.id)
      if (updateError) throw updateError
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingCell(null)
      stopEditing(row.id, 'cldt')
    }
  }

  const landedNow = async (row: ArrivalView) => {
    const cellKey = `${row.id}:aldt`
    setSavingCell(cellKey)
    setError(null)
    try {
      const { error: updateError } = await supabase
        .from('arrivals')
        .update({ aldt: new Date().toISOString(), status: 'LANDED' })
        .eq('id', row.id)
      if (updateError) throw updateError
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingCell(null)
    }
  }

  const updateStatus = async (row: ArrivalView, status: ArrivalStatus) => {
    const patch: { status: ArrivalStatus; aldt?: string } = { status }
    if (status === 'LANDED' && !row.aldt) patch.aldt = new Date().toISOString()
    const { error: updateError } = await supabase.from('arrivals').update(patch).eq('id', row.id)
    if (updateError) setError(updateError.message)
  }

  const addFlight = async () => {
    if (!session || fixes.length === 0) return
    try {
      setError(null)
      const now = new Date()
      const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
      const sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
      const { error: insertError } = await supabase.from('arrivals').insert({
        session_id: session.id,
        sequence_no: sequenceNo,
        callsign: 'NEW',
        aircraft_type: null,
        departure: null,
        ref_fix: fixes[0].fix,
        eto: isoFromClock(session.service_date, hhmm),
        status: 'INBOUND',
      })
      if (insertError) throw insertError
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const deleteFlight = async (row: ArrivalView) => {
    if (!window.confirm(`Delete ${row.callsign}?`)) return
    const { error: deleteError } = await supabase.from('arrivals').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
  }

  const saveProfileName = async () => {
    const clean = saveBrowserDisplayName(profileName)
    setProfileName(clean)
    profileNameRef.current = clean
    if (channelRef.current) {
      await channelRef.current.track({ displayName: clean, onlineAt: new Date().toISOString() })
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">✈</div>
          <div>
            <div className="eyebrow">THAILAND APPROACH TOOLS</div>
            <h1>BKK TMA Arrival Sequencing</h1>
            <p>Flow {FLOW} · Shared realtime workspace</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="clock-card"><span>UTC</span><strong>{utcNow.toISOString().slice(11, 19)}</strong></div>
          <div className="connection-pill"><span className="live-dot" /> REALTIME</div>
          <div className="controller-stack">
            <span>{onlineControllers.length || 1} online</span>
            <div className="avatar-row">
              {onlineControllers.slice(0, 4).map((name) => <i key={name} title={name}>{name.slice(0, 2).toUpperCase()}</i>)}
            </div>
          </div>
          <input className="controller-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} onBlur={() => void saveProfileName()} aria-label="Controller display name" />
          <button className="primary-button" onClick={() => void addFlight()} disabled={!session || fixes.length === 0}>+ Add Flight</button>
        </div>
      </header>

      <main className="content">
        {error && <div className="error-banner"><strong>Database:</strong> {error}</div>}

        <section className="summary-grid">
          <article className="summary-card"><span>Flights in sequence</span><strong>{arrivals.filter((row) => !['LANDED', 'CANCELLED'].includes(row.status)).length}</strong><small>{arrivals.length} total rows</small></article>
          <article className="summary-card"><span>Next landing (CLDT)</span><strong>{nextLanding ? timeOnly(nextLanding.cldt) : '—'}</strong><small>{nextLanding?.callsign ?? 'No active traffic'}</small></article>
          <article className="summary-card"><span>Average interval</span><strong>{averageInterval(arrivals)}</strong><small>CLDT planning gap</small></article>
          <article className="summary-card"><span>Controllers online</span><strong>{onlineControllers.length || 1}</strong><small>Presence channel</small></article>
        </section>

        <section className="workspace-card">
          <div className="workspace-toolbar">
            <div>
              <h2>Arrival sequence</h2>
              <p>Click editable cells. Changes autosave and appear on every connected screen.</p>
            </div>
            <div className="toolbar-controls">
              <input aria-label="Search flights" placeholder="Search callsign, aircraft or fix…" value={search} onChange={(event) => setSearch(event.target.value)} />
              <button className="secondary-button">Flow {FLOW}</button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>SEQ</th><th>CALLSIGN</th><th>A/C</th><th>DEP</th><th>REF FIX</th><th>ETO</th><th>ELDT</th><th>CLDT</th><th>CTO</th><th>ALDT</th><th title="ALDT − ELDT">EST VAR</th><th title="ALDT − CLDT">SEQ VAR</th><th>STATUS</th><th /></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={14} className="empty-state">Connecting to shared sequence…</td></tr>
                ) : visibleArrivals.length === 0 ? (
                  <tr><td colSpan={14} className="empty-state">No flights yet. Click “Add Flight” to start.</td></tr>
                ) : visibleArrivals.map((row) => {
                  const cldtOverride = !sameInstant(row.cldt, row.eldt)
                  return (
                    <tr key={row.id} className={row.status === 'LANDED' ? 'landed-row' : 'active-row'}>
                      <td className="seq-cell">{row.sequence_no}</td>
                      <td><EditableText row={row} field="callsign" value={row.callsign} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} bold /></td>
                      <td><EditableText row={row} field="aircraft_type" value={row.aircraft_type ?? ''} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} /></td>
                      <td><EditableText row={row} field="departure" value={row.departure ?? ''} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} /></td>
                      <td>
                        <div className="cell-editor-wrap">
                          <select className="cell-select" value={row.ref_fix} disabled={savingCell === `${row.id}:ref_fix`} onFocus={() => startEditing(row.id, 'ref_fix')} onChange={(event) => void updateArrival(row, 'ref_fix', event.target.value)}>
                            {fixes.map((fix) => <option key={fix.fix} value={fix.fix}>{fix.fix}</option>)}
                          </select>
                          {editing[`${row.id}:ref_fix`] && <small className="editing-tag">{editing[`${row.id}:ref_fix`].displayName}</small>}
                        </div>
                      </td>
                      <td><EditableTime row={row} field="eto" value={row.eto} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} /></td>
                      <td className="computed-cell">{timeOnly(row.eldt)}</td>
                      <td className="cldt-control-cell">
                        <EditableTime row={row} field="cldt" value={row.cldt} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} strong />
                        <div className="cldt-control-meta">
                          <span className={`cldt-mode-badge ${cldtOverride ? 'override' : 'auto'}`}>{cldtOverride ? 'OVERRIDE' : 'AUTO'}</span>
                          {cldtOverride && (
                            <button className="cldt-reset-button" onClick={() => void resetCldt(row)} disabled={savingCell === `${row.id}:cldt`} title="Reset CLDT to ELDT">↺ Reset</button>
                          )}
                        </div>
                      </td>
                      <td className="computed-cell">{timeOnly(row.cto)}</td>
                      <td><EditableTime row={row} field="aldt" value={row.aldt} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} allowEmpty /></td>
                      <td className={row.est_var?.startsWith('-') ? 'negative-var' : 'positive-var'} title="ALDT − ELDT">{intervalLabel(row.est_var)}</td>
                      <td className={row.seq_var?.startsWith('-') ? 'negative-var' : 'positive-var'} title="ALDT − CLDT">{intervalLabel(row.seq_var)}</td>
                      <td>
                        <select className={`status-select status-${row.status.toLowerCase()}`} value={row.status} onChange={(event) => void updateStatus(row, event.target.value as ArrivalStatus)}>
                          <option value="INBOUND">INBOUND</option><option value="SEQUENCED">SEQUENCED</option><option value="LANDING">LANDING</option><option value="LANDED">LANDED</option><option value="CANCELLED">CANCELLED</option>
                        </select>
                      </td>
                      <td className="row-actions-cell">
                        <div className="row-actions">
                          <button className={`landed-now-button${row.status === 'LANDED' ? ' is-landed' : ''}`} onClick={() => void landedNow(row)} disabled={row.status === 'LANDED' || savingCell === `${row.id}:aldt`} title="Set ALDT to the current UTC time and mark LANDED">{row.status === 'LANDED' ? '✓ Landed' : '✓ Landed Now'}</button>
                          <button className="icon-button danger" onClick={() => void deleteFlight(row)} title="Delete flight">×</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <footer className="workspace-footer">
            <div className="legend"><span><i className="dot editable-dot" /> Editable / autosave</span><span><i className="dot computed-dot" /> ELDT + CTO calculated</span></div>
            <div>{fixes.some((fix) => !fix.verified) ? '⚠ VTBD timing values are provisional' : 'Timing dataset verified'} · <strong className="live">● LIVE</strong></div>
          </footer>
        </section>
      </main>
    </div>
  )
}

type EditorCommon = {
  row: ArrivalView
  field: string
  saving: string | null
  editing: EditingState
  onStart: (arrivalId: string, field: string) => void
  onSave: (row: ArrivalView, field: string, value: string | null) => Promise<void>
}

function EditableText({ row, field, value, saving, editing, onStart, onSave, bold = false }: EditorCommon & { value: string; bold?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const key = `${row.id}:${field}`
  return (
    <div className="cell-editor-wrap">
      <input className={`cell-input${bold ? ' bold' : ''}`} value={draft} disabled={saving === key} onFocus={() => onStart(row.id, field)} onChange={(event) => setDraft(event.target.value.toUpperCase())} onBlur={() => { if (draft.trim() !== value) void onSave(row, field, draft.trim() || null) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      {editing[key] && <small className="editing-tag">{editing[key].displayName}</small>}
    </div>
  )
}

function EditableTime({ row, field, value, saving, editing, onStart, onSave, strong = false, allowEmpty = false }: EditorCommon & { value: string | null; strong?: boolean; allowEmpty?: boolean }) {
  const current = value ? timeOnly(value) : ''
  const [draft, setDraft] = useState(current)
  useEffect(() => setDraft(current), [current])
  const key = `${row.id}:${field}`

  const commit = () => {
    if (draft === '' && allowEmpty) {
      if (current !== '') void onSave(row, field, null)
      return
    }
    if (!isValidAtcTime(draft)) {
      setDraft(current)
      return
    }
    if (draft !== current) void onSave(row, field, draft)
  }

  return (
    <div className="cell-editor-wrap">
      <input
        type="text"
        inputMode="numeric"
        maxLength={5}
        placeholder="HH:MM"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${field.toUpperCase()} UTC time in 24-hour HH:MM format`}
        className={`cell-input time${strong ? ' strong' : ''}`}
        value={draft}
        disabled={saving === key}
        onFocus={() => onStart(row.id, field)}
        onChange={(event) => setDraft(formatAtcTimeDraft(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(current)
            event.currentTarget.blur()
          }
        }}
      />
      {editing[key] && <small className="editing-tag">{editing[key].displayName}</small>}
    </div>
  )
}

export default App
