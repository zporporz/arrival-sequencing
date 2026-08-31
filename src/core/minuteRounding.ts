export function formatRoundedHmUtc(value: string | number | Date | null) {
  if (value == null) return '--:--'
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) return '--:--'

  // Operational display rule: seconds 00-30 stay in the current minute;
  // seconds 31-59 advance to the next minute.
  if (date.getUTCSeconds() >= 31) date.setUTCMinutes(date.getUTCMinutes() + 1)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}
