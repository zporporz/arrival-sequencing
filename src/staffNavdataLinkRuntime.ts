const ADMIN_HREF = '/?admin=tools'

function ensureStaffNavdataLink() {
  if (document.documentElement.dataset.authRole !== 'STAFF') return
  const session = document.querySelector<HTMLElement>('.aman-session')
  if (!session || session.querySelector('[data-staff-navdata-link="true"]')) return

  const link = document.createElement('a')
  link.href = ADMIN_HREF
  link.textContent = 'ADMIN TOOLS'
  link.className = 'aman-staff-admin-link'
  link.dataset.staffNavdataLink = 'true'

  const signout = session.querySelector('.aman-signout')
  if (signout) session.insertBefore(link, signout)
  else session.appendChild(link)
}

export function installStaffNavdataLinkRuntime() {
  let disposed = false
  let scheduled = false

  const schedule = () => {
    if (disposed || scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed) ensureStaffNavdataLink()
    })
  }

  schedule()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    disposed = true
    observer.disconnect()
    document.querySelectorAll('[data-staff-navdata-link="true"]').forEach((element) => element.remove())
  }
}
