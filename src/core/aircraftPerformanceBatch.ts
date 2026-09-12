import { readAircraftPerformance, type AircraftPerformancePayload } from './api'

// Create a new batch for each airport traffic calculation. Repeated types share
// both pending and completed requests within that batch, never across refreshes.
// A failure uses the existing fallback for this batch and retries next refresh.
export function createAircraftPerformanceBatch(fetchPerformance = readAircraftPerformance) {
  const requests = new Map<string, Promise<AircraftPerformancePayload | null>>()
  return (aircraft: string | null | undefined): Promise<AircraftPerformancePayload | null> => {
    const type = aircraft?.trim().toUpperCase()
    if (!type) return Promise.resolve(null)
    let request = requests.get(type)
    if (!request) {
      request = Promise.resolve().then(() => fetchPerformance(type)).catch(() => null)
      requests.set(type, request)
    }
    return request
  }
}
