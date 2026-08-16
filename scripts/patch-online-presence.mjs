import fs from 'node:fs'

const appPath = 'src/App.tsx'
let app = fs.readFileSync(appPath, 'utf8')

const stateOld = `type EditingState = Record<string, { displayName: string }>

function App() {`
const stateNew = `type EditingState = Record<string, { displayName: string }>
type OnlineController = {
  key: string
  displayName: string
  vid: string | null
  roleLabel: string | null
  staffCodes: string[]
  onlineAt: string | null
}

const onlineSince = (value: string | null) => {
  if (!value) return 'Online now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Online now'
  return \`Since \${String(date.getUTCHours()).padStart(2, '0')}:\${String(date.getUTCMinutes()).padStart(2, '0')}Z\`
}

function App() {`
if (!app.includes(stateOld)) throw new Error('Online controller type marker not found')
app = app.replace(stateOld, stateNew)

const onlineStateOld = `  const [onlineControllers, setOnlineControllers] = useState<string[]>([])`
const onlineStateNew = `  const [onlineControllers, setOnlineControllers] = useState<OnlineController[]>([])`
if (!app.includes(onlineStateOld)) throw new Error('onlineControllers state marker not found')
app = app.replace(onlineStateOld, onlineStateNew)

const presenceOld = `          .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState<{ displayName?: string }>()
            const names = Object.values(state)
              .flat()
              .map((presence) => presence.displayName)
              .filter((name): name is string => Boolean(name))
            setOnlineControllers([...new Set(names)])
          })`
const presenceNew = `          .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState<{
              displayName?: string
              vid?: string
              roleLabel?: string
              staffCodes?: string[]
              onlineAt?: string
            }>()
            const byController = new Map<string, OnlineController>()
            for (const presence of Object.values(state).flat()) {
              if (!presence.displayName) continue
              const key = presence.vid?.trim() || presence.displayName.trim().toUpperCase()
              const current = byController.get(key)
              const candidate: OnlineController = {
                key,
                displayName: presence.displayName,
                vid: presence.vid?.trim() || null,
                roleLabel: presence.roleLabel?.trim() || null,
                staffCodes: Array.isArray(presence.staffCodes) ? presence.staffCodes.filter(Boolean) : [],
                onlineAt: presence.onlineAt || null,
              }
              if (!current || (candidate.onlineAt && (!current.onlineAt || candidate.onlineAt < current.onlineAt))) {
                byController.set(key, candidate)
              }
            }
            setOnlineControllers([...byController.values()].sort((left, right) => left.displayName.localeCompare(right.displayName)))
          })`
if (!app.includes(presenceOld)) throw new Error('presence sync marker not found')
app = app.replace(presenceOld, presenceNew)

const trackOld = `              await realtimeChannel.track({ displayName: profileName, onlineAt: new Date().toISOString() })`
const trackNew = `              await realtimeChannel.track({
                displayName: profileName,
                vid: authUser.vid,
                roleLabel,
                staffCodes,
                onlineAt: new Date().toISOString(),
              })`
if (!app.includes(trackOld)) throw new Error('presence track marker not found')
app = app.replace(trackOld, trackNew)

const depsOld = `  }, [identity.id, loadFixes, profileName, queueArrivalSync, refreshArrivals])`
const depsNew = `  }, [authUser.vid, identity.id, loadFixes, profileName, queueArrivalSync, refreshArrivals, roleLabel, staffCodes])`
if (!app.includes(depsOld)) throw new Error('presence effect deps marker not found')
app = app.replace(depsOld, depsNew)

const uiOld = `          <div className="controller-stack">
            <span>{onlineControllers.length || 1} online</span>
            <div className="avatar-row">
              {onlineControllers.slice(0, 4).map((name) => <i key={name} title={name}>{name.slice(0, 2).toUpperCase()}</i>)}
            </div>
          </div>`
const uiNew = `          <details className="controller-presence-menu">
            <summary className="controller-stack" title="Show controllers in this workspace">
              <span>{onlineControllers.length || 1} online</span>
              <div className="avatar-row" aria-hidden="true">
                {onlineControllers.slice(0, 4).map((controller) => <i key={controller.key} title={controller.displayName}>{controller.displayName.slice(0, 2).toUpperCase()}</i>)}
              </div>
            </summary>
            <div className="controller-presence-popover">
              <div className="controller-presence-heading">
                <div><strong>Controllers online</strong><span>{workspace?.airport ?? 'Workspace'} · RWY {workspace?.runway ?? '—'}</span></div>
                <b>{onlineControllers.length || 1}</b>
              </div>
              <div className="controller-presence-list">
                {(onlineControllers.length ? onlineControllers : [{ key: authUser.vid, displayName: profileName, vid: authUser.vid, roleLabel, staffCodes, onlineAt: null }]).map((controller) => (
                  <div className="controller-presence-item" key={controller.key}>
                    <i>{controller.displayName.slice(0, 2).toUpperCase()}</i>
                    <div className="controller-presence-identity">
                      <strong>{controller.displayName}</strong>
                      <span>{[controller.staffCodes.join(' / ') || controller.roleLabel, controller.vid ? \`VID \${controller.vid}\` : null].filter(Boolean).join(' · ')}</span>
                    </div>
                    <small>{onlineSince(controller.onlineAt)}</small>
                  </div>
                ))}
              </div>
              <div className="controller-presence-note">Presence is scoped to this arrival sequencing workspace.</div>
            </div>
          </details>`
if (!app.includes(uiOld)) throw new Error('controller stack UI marker not found')
app = app.replace(uiOld, uiNew)

fs.writeFileSync(appPath, app)

const cssPath = 'src/styles.css'
let css = fs.readFileSync(cssPath, 'utf8')
const cssMarker = `.avatar-row i:first-child { margin-left: 0; }`
if (!css.includes(cssMarker)) throw new Error('CSS presence marker not found')
const cssInsert = `${cssMarker}
.controller-presence-menu { position: relative; }
.controller-presence-menu > summary { list-style: none; cursor: pointer; user-select: none; border-radius: 9px; padding: 5px 6px; transition: background .15s ease, color .15s ease; }
.controller-presence-menu > summary::-webkit-details-marker { display: none; }
.controller-presence-menu > summary:hover,
.controller-presence-menu[open] > summary { background: #f4f7fc; color: #4f5d73; }
.controller-presence-popover {
  position: absolute;
  z-index: 40;
  top: calc(100% + 10px);
  right: 0;
  width: 360px;
  overflow: hidden;
  border: 1px solid #e0e6ef;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 18px 46px rgba(22,32,51,.14);
}
.controller-presence-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 15px 12px; border-bottom: 1px solid #edf0f5; }
.controller-presence-heading div { min-width: 0; }
.controller-presence-heading strong { display: block; font-size: 12px; color: #17233a; }
.controller-presence-heading span { display: block; margin-top: 2px; color: #8993a6; font-size: 9px; }
.controller-presence-heading b { display: grid; place-items: center; min-width: 26px; height: 26px; padding: 0 7px; border-radius: 999px; background: #edf4ff; color: #286bd9; font-size: 10px; }
.controller-presence-list { max-height: 310px; overflow-y: auto; }
.controller-presence-item { display: grid; grid-template-columns: 32px minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid #f0f2f6; }
.controller-presence-item:last-child { border-bottom: 0; }
.controller-presence-item > i { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: #e9f0ff; color: #2b67cb; font-size: 9px; font-weight: 850; font-style: normal; }
.controller-presence-identity { min-width: 0; }
.controller-presence-identity strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1b2940; font-size: 11px; }
.controller-presence-identity span { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #7f8a9d; font-size: 9px; }
.controller-presence-item small { color: #96a0b0; font-size: 8px; white-space: nowrap; }
.controller-presence-note { padding: 9px 14px; border-top: 1px solid #edf0f5; background: #fafbfc; color: #929bab; font-size: 8px; }
`
css = css.replace(cssMarker, cssInsert)
fs.writeFileSync(cssPath, css)
