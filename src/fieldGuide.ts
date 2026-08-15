const FIELD_GUIDE = [
  ['SEQ', 'Sequence Number', 'Arrival order in the landing sequence.'],
  ['CALLSIGN', 'Aircraft Callsign', 'Flight identification used by ATC and the pilot.'],
  ['A/C', 'Aircraft Type', 'Aircraft type designator, for example A320 or B77W.'],
  ['DEP', 'Departure Aerodrome', 'Aerodrome from which the flight departed.'],
  ['REF FIX', 'Reference Fix', 'Reference waypoint used for sequencing time calculations.'],
  ['ETO', 'Estimated Time Over', 'Estimated time the aircraft will pass the reference fix.'],
  ['ELDT', 'Estimated Landing Time', 'Estimated landing time calculated from ETO plus the nominal fix-to-runway time.'],
  ['CLDT', 'Calculated Landing Time', 'Landing time planned or assigned by the sequencing controller.'],
  ['CTO', 'Calculated Time Over', 'Calculated time the aircraft should cross the reference fix to achieve the CLDT.'],
  ['ALDT', 'Actual Landing Time', 'Actual time the aircraft landed.'],
  ['EST VAR', 'Estimate Variance', 'Difference between ALDT and ELDT.'],
  ['SEQ VAR', 'Sequence Variance', 'Difference between ALDT and CLDT.'],
  ['STATUS', 'Flight Status', 'Current operational state of the flight in the sequencing board.'],
] as const

export function installFieldGuide() {
  if (document.getElementById('field-guide-root')) return

  const root = document.createElement('div')
  root.id = 'field-guide-root'
  root.innerHTML = `
    <button class="field-guide-trigger" type="button" aria-expanded="false" aria-controls="field-guide-panel">
      <span class="field-guide-trigger-icon">i</span>
      <span>Field Guide</span>
    </button>
    <div class="field-guide-backdrop" hidden></div>
    <aside id="field-guide-panel" class="field-guide-panel" aria-hidden="true" aria-label="Sequencing field definitions">
      <div class="field-guide-head">
        <div>
          <span class="field-guide-kicker">ARRIVAL SEQUENCING</span>
          <h2>Field Guide</h2>
          <p>Abbreviations and operational field definitions used on this board.</p>
        </div>
        <button class="field-guide-close" type="button" aria-label="Close field guide">×</button>
      </div>
      <div class="field-guide-list">
        ${FIELD_GUIDE.map(([abbr, name, description]) => `
          <article class="field-guide-item">
            <div class="field-guide-code">${abbr}</div>
            <div>
              <h3>${name}</h3>
              <p>${description}</p>
            </div>
          </article>
        `).join('')}
      </div>
      <div class="field-guide-note">
        <strong>Timing note</strong>
        <span>ELDT and CTO are calculated values. CLDT is the controller planning value. The 2-minute gap warning is a sequencing planning target, not a universal separation minimum.</span>
      </div>
    </aside>
  `

  document.body.appendChild(root)

  const trigger = root.querySelector<HTMLButtonElement>('.field-guide-trigger')!
  const panel = root.querySelector<HTMLElement>('.field-guide-panel')!
  const backdrop = root.querySelector<HTMLElement>('.field-guide-backdrop')!
  const close = root.querySelector<HTMLButtonElement>('.field-guide-close')!

  const setOpen = (open: boolean) => {
    panel.classList.toggle('open', open)
    panel.setAttribute('aria-hidden', String(!open))
    trigger.setAttribute('aria-expanded', String(open))
    backdrop.hidden = !open
    document.body.classList.toggle('field-guide-open', open)
  }

  trigger.addEventListener('click', () => setOpen(true))
  close.addEventListener('click', () => setOpen(false))
  backdrop.addEventListener('click', () => setOpen(false))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.classList.contains('open')) setOpen(false)
  })
}
