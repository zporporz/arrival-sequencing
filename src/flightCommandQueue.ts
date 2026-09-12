const queues = new Map<string, Promise<unknown>>()
const savedRevisions = new Map<string, number>()
const savedTargetRevisions = new Map<string, number>()

export function optionalRevision(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined
}

// Serialize MANUAL and AUTO together. An already-sent drag must finish before
// its AUTO reset; a failed command must not permanently block the next one.
export function enqueueFlightCommand<T>(key: string, command: () => Promise<T>): Promise<T> {
  const previous = queues.get(key)
  const result = previous ? previous.catch(() => undefined).then(command) : command()
  queues.set(key, result)
  const cleanup = () => { if (queues.get(key) === result) queues.delete(key) }
  void result.then(cleanup, cleanup)
  return result
}

export async function writeFlightCommand(body: Record<string, unknown>): Promise<Response> {
  const key = `${body.serviceDate}:${body.airport}:${body.callsign}`
  return enqueueFlightCommand(key, async () => {
    // Use the displayed shared revision or the preceding queued save. Only a
    // newly discovered flight needs a read; ordinary drags add no extra round trip.
    let revision = Math.max(Number(body.expectedRevision) || 0, savedRevisions.get(key) || 0)
    const targetCandidates = [optionalRevision(body.expectedTargetRevision), savedTargetRevisions.get(key)]
      .filter((value): value is number => value !== undefined)
    let targetRevision = targetCandidates.length ? Math.max(...targetCandidates) : undefined
    if (!revision && targetRevision === undefined) {
      const snapshot = await fetch(`/api/sequence/aman-state?serviceDate=${encodeURIComponent(String(body.serviceDate))}&airports=${encodeURIComponent(String(body.airport))}`, {
        credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      })
      if (!snapshot.ok) throw new Error('Unable to check current shared target')
      const state = await snapshot.json() as { flightStates?: Array<{ callsign: string; revision: number; target_revision?: number }> }
      const flight = state.flightStates?.find(row => row.callsign === body.callsign)
      revision = flight?.revision ?? 0
      targetRevision = optionalRevision(flight?.target_revision)
    }
    const response = await fetch('/api/sequence/aman-state', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...body, expectedRevision: revision, expectedTargetRevision: targetRevision }),
    })
    if (response.ok) {
      const result = await response.clone().json() as { flightState?: { revision?: number; target_revision?: number } }
      if (result.flightState?.revision) savedRevisions.set(key, result.flightState.revision)
      const nextTargetRevision = optionalRevision(result.flightState?.target_revision)
      if (nextTargetRevision !== undefined) savedTargetRevisions.set(key, nextTargetRevision)
    } else if (response.status === 409) {
      savedRevisions.delete(key)
      savedTargetRevisions.delete(key)
      window.dispatchEvent(new CustomEvent('aman:force-shared-refresh'))
    }
    return response
  })
}
