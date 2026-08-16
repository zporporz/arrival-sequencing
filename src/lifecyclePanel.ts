import { supabase } from './lib/supabase'

type ViewMode = 'ACTIVE' | 'COMPLETED' | 'ALL'

type AuditLog = {
  id: number
  record_id: string | null
  action: string
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
  changed_by_label: string | null
  changed_at: string
}

type ActivityEntry = {
  id: number
  detail: string
  actor: string
  changedAt: string
}

type ActivityGroup = {
  key: string
  callsign: string
  sequenceNo: string
  entries: ActivityEntry[]
}

let viewMode: ViewMode = 'ACTIVE'
let activityOpen = false
let activityLoading = false

const completedStatuses = new Set(['LANDED', 'CANCELLED'])

function currentFlow() {
  return new URLSearchParams(window.location.search).get('flow') === '03' ? '03' : '21'
}

function statusForRow(row: HTMLTableRowElement) {
  return row.querySelector<HTMLSelectElement>('.status-select')?.value ?? ''
}

function matchesView(status: string) {
  if (viewMode === 'ALL') return true
  if (viewMode === 'COMPLETED') return completedStatuses.has(status)
  return !completedStatuses.has(status)
}

function refreshRows() {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')]
  let active = 0
  let completed = 0

  for (const row of rows) {
    if (!row.querySelector('.status-select')) continue
    const status = statusForRow(row)
    if (completedStatuses.has(status)) completed += 1
    else active += 1
    row.classList.toggle('lifecycle-hidden-row', !matchesView(status))
  }

  document.querySelectorAll<HTMLButtonElement>('.lifecycle-tab').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === viewMode)
  })

  const activeCount = document.querySelector<HTMLElement>('[data-lifecycle-count="ACTIVE"]')
  const completedCount = document.querySelector<HTMLElement>('[data-lifecycle-count="COMPLETED"]')
  if (activeCount) activeCount.textContent = String(active)
  if (completedCount) completedCount.textContent = String(completed)
}

function installTabs() {
  const toolbar = document.querySelector<HTMLElement>('.workspace-toolbar')
  if (!toolbar || toolbar.querySelector('.lifecycle-tabs')) return false

  const tabs = document.createElement('div')
  tabs.className = 'lifecycle-tabs'

  for (const item of [
    ['ACTIVE', 'Active'],
    ['COMPLETED', 'Completed'],
    ['ALL', 'All'],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'lifecycle-tab'
    button.dataset.view = item[0]

    const label = document.createElement('span')
    label.textContent = item[1]
    button.appendChild(label)

    if (item[0] !== 'ALL') {
      const count = document.createElement('b')
      count.dataset.lifecycleCount = item[0]
      count.textContent = '0'
      button.appendChild(count)
    }

    button.addEventListener('click', () => {
      viewMode = item[0]
      refreshRows()
    })
    tabs.appendChild(button)
  }

  const left = toolbar.firstElementChild
  if (left) left.appendChild(tabs)
  else toolbar.prepend(tabs)
  return true
}

function installQuickCancel() {
  document.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
    const actions = row.querySelector<HTMLElement>('.row-actions')
    const status = row.querySelector<HTMLSelectElement>('.status-select')
    if (!actions || !status || actions.querySelector('.quick-cancel-button')) return

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'quick-cancel-button'
    cancel.textContent = 'Cancel'
    cancel.title = 'Mark this flight CANCELLED'
    cancel.disabled = completedStatuses.has(status.value)
    cancel.addEventListener('click', () => {
      if (status.value === 'CANCELLED') return
      status.value = 'CANCELLED'
      status.dispatchEvent(new Event('change', { bubbles: true }))
    })
    actions.insertBefore(cancel, actions.lastElementChild)
  })
}

function valueLabel(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return '—'
  if (['eto', 'cldt', 'aldt'].includes(field)) {
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) {
      return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
    }
  }
  return String(value)
}

const visibleFields = ['callsign', 'aircraft_type', 'departure', 'ref_fix', 'eto', 'cldt', 'aldt', 'status'] as const

function describeAudit(log: AuditLog) {
  const before = log.old_row ?? {}
  const after = log.new_row ?? {}
  const callsign = String(after.callsign ?? before.callsign ?? 'Flight')
  const sequenceNo = String(after.sequence_no ?? before.sequence_no ?? '—')

  if (log.action === 'INSERT') return { callsign, sequenceNo, detail: 'Flight added to sequence' }
  if (log.action === 'DELETE') return { callsign, sequenceNo, detail: 'Flight deleted from sequence' }

  const changes: string[] = []
  for (const field of visibleFields) {
    const oldValue = before[field]
    const newValue = after[field]
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue
    changes.push(`${field.toUpperCase()} ${valueLabel(oldValue, field)} → ${valueLabel(newValue, field)}`)
  }

  if (changes.length === 0) return null
  return { callsign, sequenceNo, detail: changes.join(' · ') }
}

function auditMatchesSession(log: AuditLog, sessionId: string) {
  const row = log.new_row ?? log.old_row
  return row?.session_id === sessionId
}

function groupActivity(logs: AuditLog[]) {
  const groups = new Map<string, ActivityGroup>()

  for (const log of logs) {
    const description = describeAudit(log)
    if (!description) continue

    const key = log.record_id ?? `audit-${log.id}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        callsign: description.callsign,
        sequenceNo: description.sequenceNo,
        entries: [],
      }
      groups.set(key, group)
    }

    group.entries.push({
      id: log.id,
      detail: description.detail,
      actor: log.changed_by_label || 'Controller',
      changedAt: log.changed_at,
    })
  }

  return [...groups.values()]
}

function utcLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}Z`
}

async function resolveSessionId() {
  const todayUtc = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('sequence_sessions')
    .select('id')
    .eq('airport', 'VTBD')
    .eq('flow', currentFlow())
    .eq('service_date', todayUtc)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.id as string | undefined
}

async function loadActivity() {
  if (activityLoading) return
  activityLoading = true
  const list = document.querySelector<HTMLElement>('.activity-list')
  const state = document.querySelector<HTMLElement>('.activity-state')
  if (state) state.textContent = 'Loading activity…'

  try {
    const sessionId = await resolveSessionId()
    if (!sessionId) throw new Error('No active sequence session')

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, record_id, action, old_row, new_row, changed_by_label, changed_at')
      .eq('table_name', 'arrivals')
      .order('changed_at', { ascending: false })
      .limit(200)
    if (error) throw error

    const logs = ((data ?? []) as AuditLog[]).filter((log) => auditMatchesSession(log, sessionId))
    const groups = groupActivity(logs).slice(0, 30)
    if (list) list.replaceChildren()

    for (const group of groups) {
      if (!list) break

      const details = document.createElement('details')
      details.className = 'activity-group'

      const summary = document.createElement('summary')
      const identity = document.createElement('div')
      identity.className = 'activity-group-identity'
      const seq = document.createElement('span')
      seq.textContent = `SEQ ${group.sequenceNo}`
      const callsign = document.createElement('strong')
      callsign.textContent = group.callsign
      identity.append(seq, callsign)

      const meta = document.createElement('div')
      meta.className = 'activity-group-meta'
      const count = document.createElement('b')
      count.textContent = `${group.entries.length} ${group.entries.length === 1 ? 'change' : 'changes'}`
      const latest = document.createElement('time')
      latest.textContent = utcLabel(group.entries[0]?.changedAt ?? '')
      meta.append(count, latest)

      summary.append(identity, meta)
      details.appendChild(summary)

      const history = document.createElement('div')
      history.className = 'activity-group-history'
      for (const entry of group.entries) {
        const item = document.createElement('article')
        item.className = 'activity-entry'

        const top = document.createElement('div')
        const actor = document.createElement('strong')
        actor.textContent = entry.actor
        const time = document.createElement('time')
        time.textContent = utcLabel(entry.changedAt)
        top.append(actor, time)

        const detail = document.createElement('p')
        detail.textContent = entry.detail
        item.append(top, detail)
        history.appendChild(item)
      }

      details.appendChild(history)
      list.appendChild(details)
    }

    if (state) state.textContent = groups.length ? '' : 'No activity yet.'
  } catch (error) {
    if (state) state.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    activityLoading = false
  }
}

function installActivityPanel() {
  if (document.querySelector('.activity-panel')) return

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'activity-toggle'
  toggle.textContent = 'Activity'
  toggle.title = 'Open recent sequence activity'

  const panel = document.createElement('aside')
  panel.className = 'activity-panel'
  panel.setAttribute('aria-hidden', 'true')

  const header = document.createElement('header')
  const titleWrap = document.createElement('div')
  const eyebrow = document.createElement('small')
  eyebrow.textContent = 'LIVE AUDIT TRAIL'
  const title = document.createElement('h3')
  title.textContent = 'Recent activity'
  titleWrap.append(eyebrow, title)

  const headerActions = document.createElement('div')
  headerActions.className = 'activity-header-actions'
  const refreshButton = document.createElement('button')
  refreshButton.type = 'button'
  refreshButton.className = 'activity-refresh'
  refreshButton.textContent = 'Refresh'
  refreshButton.title = 'Refresh activity now'
  refreshButton.addEventListener('click', () => void loadActivity())

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'activity-close'
  close.textContent = '×'
  close.title = 'Close activity'
  headerActions.append(refreshButton, close)
  header.append(titleWrap, headerActions)

  const state = document.createElement('div')
  state.className = 'activity-state'
  const list = document.createElement('div')
  list.className = 'activity-list'
  panel.append(header, state, list)

  const setOpen = (open: boolean) => {
    activityOpen = open
    panel.classList.toggle('is-open', open)
    panel.setAttribute('aria-hidden', String(!open))
    toggle.classList.toggle('is-active', open)
    if (open) void loadActivity()
  }

  toggle.addEventListener('click', () => setOpen(!activityOpen))
  close.addEventListener('click', () => setOpen(false))

  document.body.append(toggle, panel)
}

function refresh() {
  installTabs()
  installQuickCancel()
  installActivityPanel()
  refreshRows()
}

export function installLifecyclePanel() {
  let frame = 0
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(refresh)
  }

  const start = () => {
    schedule()
    document.addEventListener('change', schedule, true)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.setInterval(() => {
      schedule()
      if (activityOpen) void loadActivity()
    }, 15000)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}
