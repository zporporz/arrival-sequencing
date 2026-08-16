type SequenceSession = {
  id: string
  airport: string
  flow: string
  runway_config: string | null
  service_date: string
  status: string
  created_at: string
}

type Props = { sessions: SequenceSession[] }

function fmtTime(value: string) {
  return new Date(value).toLocaleString('en-GB', { hour12: false, timeZone: 'UTC' }) + ' UTC'
}

export default function SessionsPanel({ sessions }: Props) {
  return (
    <section className="admin-card wide-card">
      <div className="admin-card-heading">
        <div><span className="admin-label">SESSIONS</span><h2>Sequence history</h2><p>Current and previous sequencing sessions. Close/reopen controls and arrival playback are the next session milestone.</p></div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>DATE</th><th>AIRPORT</th><th>FLOW</th><th>RUNWAY</th><th>STATUS</th><th>CREATED</th></tr></thead>
          <tbody>
            {sessions.length === 0 ? <tr><td colSpan={6} className="admin-empty-cell">No sessions yet.</td></tr> : sessions.map((session) => <tr key={session.id}><td>{session.service_date}</td><td><strong>{session.airport}</strong></td><td>{session.flow}</td><td>{session.runway_config ?? '—'}</td><td>{session.status}</td><td>{fmtTime(session.created_at)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
