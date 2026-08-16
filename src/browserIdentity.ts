export type BrowserIdentity = { id: string; displayName: string }

export type AuthenticatedIdentity = {
  vid: string
  displayName: string
  tooltip: string
  name?: string
  isThailandStaff?: boolean
  staffPositions?: string[]
}

const ID_KEY = 'arrival-sequencing-controller-id'
const NAME_KEY = 'arrival-sequencing-controller-name'
const AUTH_VID_KEY = 'arrival-sequencing-auth-vid'
const AUTH_DISPLAY_KEY = 'arrival-sequencing-auth-display'
const AUTH_TOOLTIP_KEY = 'arrival-sequencing-auth-tooltip'
const AUTH_META_KEY = 'arrival-sequencing-auth-meta'

export function getAuthenticatedVid() {
  try {
    return sessionStorage.getItem(AUTH_VID_KEY)
  } catch {
    return null
  }
}

function getAuthenticatedDisplayName() {
  try {
    return sessionStorage.getItem(AUTH_DISPLAY_KEY)
  } catch {
    return null
  }
}

export function getAuthenticatedIdentity(): AuthenticatedIdentity | null {
  try {
    const vid = sessionStorage.getItem(AUTH_VID_KEY)
    if (!vid) return null

    let metadata: Partial<AuthenticatedIdentity> = {}
    const rawMetadata = sessionStorage.getItem(AUTH_META_KEY)
    if (rawMetadata) {
      try {
        metadata = JSON.parse(rawMetadata) as Partial<AuthenticatedIdentity>
      } catch {
        metadata = {}
      }
    }

    return {
      ...metadata,
      vid,
      displayName: sessionStorage.getItem(AUTH_DISPLAY_KEY) || metadata.displayName || vid,
      tooltip: sessionStorage.getItem(AUTH_TOOLTIP_KEY) || metadata.tooltip || `VID ${vid}`,
    }
  } catch {
    return null
  }
}

export function setAuthenticatedIdentity(identity: AuthenticatedIdentity | null) {
  try {
    if (identity) {
      sessionStorage.setItem(AUTH_VID_KEY, identity.vid)
      sessionStorage.setItem(AUTH_DISPLAY_KEY, identity.displayName)
      sessionStorage.setItem(AUTH_TOOLTIP_KEY, identity.tooltip)
      sessionStorage.setItem(AUTH_META_KEY, JSON.stringify(identity))
      localStorage.setItem(NAME_KEY, identity.displayName)
    } else {
      sessionStorage.removeItem(AUTH_VID_KEY)
      sessionStorage.removeItem(AUTH_DISPLAY_KEY)
      sessionStorage.removeItem(AUTH_TOOLTIP_KEY)
      sessionStorage.removeItem(AUTH_META_KEY)
    }
  } catch {
    // Storage can be unavailable in hardened/private browser modes.
  }
}

// Kept for compatibility with older callers while auth is being migrated.
export function setAuthenticatedVid(vid: string | null) {
  if (!vid) {
    setAuthenticatedIdentity(null)
    return
  }
  setAuthenticatedIdentity({ vid, displayName: vid, tooltip: `VID ${vid}` })
}

export function getBrowserIdentity(): BrowserIdentity {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ID_KEY, id)
  }

  const displayName =
    getAuthenticatedDisplayName() ??
    getAuthenticatedVid() ??
    localStorage.getItem(NAME_KEY) ??
    `ATC-${id.replaceAll('-', '').slice(0, 4).toUpperCase()}`

  return { id, displayName }
}

export function saveBrowserDisplayName(value: string) {
  const lockedDisplayName = getAuthenticatedDisplayName()
  if (lockedDisplayName) {
    localStorage.setItem(NAME_KEY, lockedDisplayName)
    return lockedDisplayName
  }

  const clean = value.trim() || 'Controller'
  localStorage.setItem(NAME_KEY, clean)
  return clean
}
