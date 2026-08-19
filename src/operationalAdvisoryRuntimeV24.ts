import { installOperationalAdvisoryRuntime } from './operationalAdvisoryRuntime'

// MAESTRO v2.4 knowgood specifies a 15-second ETA-FF update cadence. The legacy
// advisory runtime is otherwise retained because it already owns Holding/LEAVE and
// planning-speed decoration. During installation only, remap its 30-second traffic
// refresh timer to 15 seconds; its 1-second HMI decoration timer is left untouched.
export function installOperationalAdvisoryRuntimeV24() {
  const originalSetInterval = window.setInterval.bind(window)
  const patchedSetInterval: typeof window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const adjustedTimeout = timeout === 30_000 ? 15_000 : timeout
    return originalSetInterval(handler, adjustedTimeout, ...args)
  }) as typeof window.setInterval

  window.setInterval = patchedSetInterval
  try {
    return installOperationalAdvisoryRuntime()
  } finally {
    window.setInterval = originalSetInterval
  }
}
