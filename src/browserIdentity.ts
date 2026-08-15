export type BrowserIdentity = { id: string; displayName: string }

const ID_KEY = 'arrival-sequencing-controller-id'
const NAME_KEY = 'arrival-sequencing-controller-name'

export function getBrowserIdentity(): BrowserIdentity {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ID_KEY, id)
  }

  const displayName =
    localStorage.getItem(NAME_KEY) ?? `ATC-${id.replaceAll('-', '').slice(0, 4).toUpperCase()}`

  return { id, displayName }
}

export function saveBrowserDisplayName(value: string) {
  const clean = value.trim() || 'Controller'
  localStorage.setItem(NAME_KEY, clean)
  return clean
}
