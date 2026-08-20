import { readAircraftPerformance, type AircraftPerformanceCategory } from './api'

const categoryCache = new Map<string, AircraftPerformanceCategory | null>()
const categoryRequests = new Map<string, Promise<void>>()

function normalizeAircraftType(value: string | null | undefined) {
  const type = String(value || '').trim().toUpperCase().split(/[\s/]/)[0]
  return /^[A-Z0-9]{2,8}$/.test(type) ? type : null
}

export function cachedAircraftPerformanceCategory(aircraftType: string | null | undefined) {
  const type = normalizeAircraftType(aircraftType)
  if (!type) return null

  if (categoryCache.has(type)) return categoryCache.get(type) ?? null

  if (!categoryRequests.has(type)) {
    const request = readAircraftPerformance(type)
      .then((payload) => {
        categoryCache.set(type, payload.found && payload.profile ? payload.profile.performanceCategory ?? null : null)
      })
      .catch(() => {
        categoryCache.set(type, null)
      })
      .finally(() => {
        categoryRequests.delete(type)
      })
    categoryRequests.set(type, request)
  }

  return null
}

export function clearAircraftPerformanceCategoryCache() {
  categoryCache.clear()
  categoryRequests.clear()
}
