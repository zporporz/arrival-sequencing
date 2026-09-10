import { afterEach, describe, expect, it, vi } from 'vitest'
import { installOperationalAdvisoryRuntime } from '../src/operationalAdvisoryRuntime'

vi.mock('../src/core/api', () => ({ readIvaoTraffic: async () => ({ flights: [] }) }))
let stop: (() => void) | undefined
afterEach(() => { stop?.(); document.body.innerHTML = '' })

describe('regional operational advisories', () => {
  it.each(['18', '36', '09', '27'])('reads %s and the numeric delay without concatenating labels', runway => {
    document.body.innerHTML = `<div class="aman-flight-row action-path_stretching" data-ref-fix="ADLUS" data-delay-minutes="7.3" title="VTCC RWY ${runway}">
      <span>08:14</span><strong>TESTCC1</strong><span>A320</span><span class="fix-code">A</span><span>07:59</span>
      <b><span>7</span><small>300</small></b><em class="runway-assignment">CC/${runway}</em></div>`
    stop = installOperationalAdvisoryRuntime()
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    expect(row.dataset.tdly).toBe('7.3')
    expect(row.dataset.assignedRunway).toBe(runway)
    expect(row.title).not.toContain('TDLY 7300')
  })
  it('does not invent a holding leave time after FF has already been passed', () => {
    document.body.innerHTML = `<div class="aman-flight-row action-holding" data-ref-fix="ANPUB" data-delay-minutes="15" data-eta-ff-passed="true" title="VTSP RWY 27 · STA-FF/TTO PASSED">
      <span>08:30</span><strong>TESTSP1</strong><span>A320</span><span class="fix-code">A</span><span>PASSED</span>
      <b>15</b><em class="runway-assignment">SP/27</em></div>`
    stop = installOperationalAdvisoryRuntime()
    expect(document.querySelector('.aman-flight-row')!.getAttribute('title')).toContain('HOLD at ANPUB · leave --:--Z')
  })
})
