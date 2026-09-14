import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AuthGate from '../src/AuthGate'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  sessionStorage.clear()
  localStorage.clear()
  delete document.documentElement.dataset.authRole
  delete document.documentElement.dataset.authVid
  vi.unstubAllGlobals()
})

it('keeps the private workspace hidden while the session request is pending', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  await act(async () => root.render(<AuthGate><div>Private AMAN</div></AuthGate>))

  expect(container.querySelector('[role="status"]')?.textContent).toContain('Checking IVAO session')
  expect(container.querySelector('.login-logo')).not.toBeNull()
  expect(container.querySelector('.auth-login-button')).toBeNull()
  expect(container.textContent).not.toContain('Private AMAN')
})

it('still opens the private workspace after a valid IVAO session', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    authenticated: true,
    user: {
      id: 123456, vid: '123456', name: 'Test Controller', publicNickname: null,
      divisionId: 'TH', countryId: 'TH', atcRating: null, pilotRating: null,
      isIvaoStaff: false, isThailandStaff: false, role: 'MEMBER', staffPositions: [],
      createdAt: new Date().toISOString(),
    },
  })))
  await act(async () => root.render(<AuthGate><div>Private AMAN</div></AuthGate>))

  expect(container.querySelector('.auth-root')?.textContent).toBe('Private AMAN')
  expect(container.querySelector('.auth-landing')).toBeNull()
  expect(document.documentElement.dataset.authVid).toBe('123456')
})

it.each([401, 503])('keeps the framed local logo and IVAO login usable after session response %s', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ authenticated: false }, { status })))
  await act(async () => root.render(<AuthGate><div>Private AMAN</div></AuthGate>))

  const logo = container.querySelector('.login-logo')!
  expect(logo.getAttribute('role')).toBe('img')
  expect(logo.getAttribute('aria-label')).toBe('IVAO Thailand')
  expect(logo.getAttribute('viewBox')).toBe('1800 820 5900 2050')
  expect(logo.querySelector('image')?.getAttribute('href')).toContain('ivao-thailand-logo.png')
  expect(container.querySelector('.auth-login-button')?.getAttribute('href')).toBe('/api/auth/login')
  expect(container.textContent).not.toContain('Private AMAN')
  expect(container.querySelector('[role="alert"]') != null).toBe(status === 503)
})
