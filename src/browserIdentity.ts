export type BrowserIdentity = { id: string; displayName: string }

const ID_KEY = 'arrival-sequencing-controller-id'
const NAME_KEY = 'arrival-sequencing-controller-name'
const AUTH_VID_KEY = 'arrival-sequencing-auth-vid'

function authenticatedVid() {
  try {
    return sessionStorage.getItem(AUTH_VID_KEY)
  } catch {
    return null
  }
}

export function setAuthenticatedVid(vid: string | null) {
  try {
    if (vid) {
      sessionStorage.setItem(AUTH_VID_KEY, vid)
      localStorage.setItem(NAME_KEY, vid)
    } else {
      sessionStorage.removeItem(AUTH_VID_KEY)
    }
  } catch {
    // Storage can be unavailable in hardened/private browser modes.
  }
}

export function getBrowserIdentity(): BrowserIdentity {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ID_KEY, id)
  }

  const displayName =
    authenticatedVid() ??
    localStorage.getItem(NAME_KEY) ??
    `ATC-${id.replaceAll('-', '').slice(0, 4).toUpperCase()}`

  return { id, displayName }
}

export function saveBrowserDisplayName(value: string) {
  const lockedVid = authenticatedVid()
  if (lockedVid) {
    localStorage.setItem(NAME_KEY, lockedVid)
    return lockedVid
  }

  const clean = value.trim() || 'Controller'
  localStorage.setItem(NAME_KEY, clean)
  return clean
}
