import type { OperationalConfigPayload } from './api'

function contentKey(config: OperationalConfigPayload) {
  // Only the response-generation timestamp is irrelevant. Include service date,
  // all workspaces/timing metadata, and future fields. Preserve array order:
  // duplicate workspace/fix entries can make that order meaningful to lookup.
  const content = Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'generatedAt'))
  return JSON.stringify(content, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : value)
}

export function retainUnchangedOperationalConfig(
  previous: OperationalConfigPayload | null,
  incoming: OperationalConfigPayload,
): OperationalConfigPayload {
  return previous && contentKey(previous) === contentKey(incoming) ? previous : incoming
}
