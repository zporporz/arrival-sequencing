function installRestoreButtons() {
  document.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
    const status = row.querySelector<HTMLSelectElement>('.status-select')
    const actions = row.querySelector<HTMLElement>('.row-actions')
    if (!status || !actions) return

    const cancel = actions.querySelector<HTMLButtonElement>('.quick-cancel-button')
    let restore = actions.querySelector<HTMLButtonElement>('.restore-cancelled-button')

    if (status.value !== 'CANCELLED') {
      restore?.remove()
      cancel?.classList.remove('hidden-for-restore')
      return
    }

    cancel?.classList.add('hidden-for-restore')
    if (restore) return

    restore = document.createElement('button')
    restore.type = 'button'
    restore.className = 'restore-cancelled-button'
    restore.textContent = '↺ Restore'
    restore.title = 'Restore this cancelled flight to INBOUND'
    restore.addEventListener('click', () => {
      if (status.value !== 'CANCELLED') return
      status.value = 'INBOUND'
      status.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const deleteButton = actions.querySelector('.icon-button.danger')
    actions.insertBefore(restore, deleteButton)
  })
}

export function installRestoreCancelled() {
  let frame = 0
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(installRestoreButtons)
  }

  const start = () => {
    schedule()
    document.addEventListener('change', schedule, true)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}
