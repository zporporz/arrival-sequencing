import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LoginLanding from '../src/LoginLanding'

let root: Root, container: HTMLDivElement
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
  vi.unstubAllGlobals()
})
it('shows a named loading status without exposing login or private workspace during session checks', async () => {
  await act(async () => root.render(<LoginLanding loading error={null} />))
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Checking IVAO session')
  expect(container.querySelector('.login-card')?.getAttribute('aria-busy')).toBe('true')
  expect(container.querySelector('.auth-login-button')).toBeNull()
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('keeps the same OAuth URL with clear workspace information and no local password form', async () => {
  await act(async () => root.render(<LoginLanding loading={false} error={null} />))
  expect(container.querySelector('h1')?.textContent).toBe('ArrivalSequencing')
  expect(container.querySelector('.auth-login-button')?.getAttribute('href')).toBe('/api/auth/login')
  expect(container.querySelector('input, form')).toBeNull()
  expect(container.querySelector('.login-retry')).toBeNull()
  expect(container.textContent).toContain('A shared arrival-sequencing workspace for the IVAO simulation network')
  expect([...container.querySelectorAll('.login-airports li')].map(li => li.textContent)).toEqual(['VTBD', 'VTBS', 'VTCC', 'VTSP'])
})
it('renders provider errors as text with a keyboard-accessible retry button', async () => {
  await act(async () => root.render(<LoginLanding loading={false} error={'<script>unsafe()</script>'} />))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('<script>unsafe()</script>')
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('.login-retry')?.tagName).toBe('BUTTON')
  expect(container.querySelector('.auth-login-button')).not.toBeNull()
})
