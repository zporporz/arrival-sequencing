import { describe, expect, it } from 'vitest'
import { collapseDuplicateLandings } from '../functions/api/sequence/landed-history.js'
import { dedupeLandedRecords } from '../src/landedHistoryRuntime'

const duplicateRecords = [
  {
    airport: 'VTBS',
    callsign: 'FSM101',
    raw_session_id: 'new-session',
    aircraft_type: 'B738',
    landed_at: '2026-08-25T14:18:00.000Z',
    last_seen_at: '2026-08-25T14:19:00.000Z',
    snapshot: { sessionId: 'new-session', state: 'TAXI' },
  },
  {
    airport: 'VTBS',
    callsign: 'FSM101',
    raw_session_id: 'old-session',
    aircraft_type: 'B738',
    landed_at: '2026-08-25T14:17:00.000Z',
    last_seen_at: '2026-08-25T14:17:00.000Z',
    snapshot: { sessionId: 'old-session', state: 'LANDED' },
  },
]

function expectCollapsed(records) {
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    airport: 'VTBS',
    callsign: 'FSM101',
    raw_session_id: 'new-session',
    landed_at: '2026-08-25T14:17:00.000Z',
    snapshot: { sessionId: 'new-session', state: 'TAXI' },
  })
}

describe('landed-history reconnect deduplication', () => {
  it('collapses duplicate database rows while preserving first ALDT and latest IVAO session', () => {
    expectCollapsed(collapseDuplicateLandings(duplicateRecords))
  })

  it('defensively collapses duplicate API rows in the browser runtime', () => {
    expectCollapsed(dedupeLandedRecords(duplicateRecords))
  })

  it('keeps different callsigns as separate landings', () => {
    const records = collapseDuplicateLandings([
      ...duplicateRecords,
      { ...duplicateRecords[0], callsign: 'THA101', raw_session_id: 'tha-session' },
    ])
    expect(records).toHaveLength(2)
  })
})
