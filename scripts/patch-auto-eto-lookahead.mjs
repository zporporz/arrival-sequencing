import fs from 'node:fs'

const tsxPath = 'src/IvaoTrafficPanel.tsx'
let tsx = fs.readFileSync(tsxPath, 'utf8')

function replaceOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`)
  return source.replace(oldText, newText)
}

tsx = replaceOnce(
  tsx,
  `const AUTO_ETO_LOOKAHEAD_MIN = 60\nconst MIN_AUTO_GS_KT = 80`,
  `const DEFAULT_AUTO_ETO_LOOKAHEAD_MIN = 60\nconst AUTO_ETO_LOOKAHEAD_OPTIONS = [30, 45, 60, 90, 120]\nconst AUTO_ETO_LOOKAHEAD_STORAGE_KEY = 'ivao-auto-eto-lookahead-min'\nconst MIN_AUTO_GS_KT = 80`,
  'lookahead constants',
)

tsx = replaceOnce(
  tsx,
  `  groundSpeed: number | null,\n  baseTimeIso: string,\n): AutoEstimate {`,
  `  groundSpeed: number | null,\n  baseTimeIso: string,\n  lookaheadMin: number,\n): AutoEstimate {`,
  'autoEstimate signature',
)

tsx = replaceOnce(
  tsx,
  `  if (minutes > AUTO_ETO_LOOKAHEAD_MIN) {\n    return { status: 'waiting', refFix, eto, remainingNm, minutes, groundSpeed, offRouteNm: progress.offRouteNm, reason: \`Outside \${AUTO_ETO_LOOKAHEAD_MIN} min ETA window\` }\n  }`,
  `  if (minutes > lookaheadMin) {\n    return { status: 'waiting', refFix, eto, remainingNm, minutes, groundSpeed, offRouteNm: progress.offRouteNm, reason: \`Outside \${lookaheadMin} min ETA window\` }\n  }`,
  'autoEstimate threshold',
)

tsx = replaceOnce(
  tsx,
  `function estimateText(estimate: AutoEstimate | undefined, manual: boolean) {`,
  `function estimateText(estimate: AutoEstimate | undefined, manual: boolean, lookaheadMin: number) {`,
  'estimateText signature',
)

tsx = replaceOnce(
  tsx,
  `    return \`AUTO ETO waiting · ~\${Math.ceil(estimate.minutes || 0)} min to destination · auto-fill starts ETA ≤\${AUTO_ETO_LOOKAHEAD_MIN} min\``,
  `    return \`AUTO ETO waiting · ~\${Math.ceil(estimate.minutes || 0)} min to destination · auto-fill starts ETA ≤\${lookaheadMin} min\``,
  'waiting text',
)

tsx = replaceOnce(
  tsx,
  `  const [open, setOpen] = useState(false)\n  const [idle, setIdle] = useState(false)\n  const lastActivityRef = useRef(Date.now())`,
  `  const [open, setOpen] = useState(false)\n  const [idle, setIdle] = useState(false)\n  const [lookaheadMin, setLookaheadMin] = useState(() => {\n    try {\n      const stored = Number(window.localStorage.getItem(AUTO_ETO_LOOKAHEAD_STORAGE_KEY))\n      return AUTO_ETO_LOOKAHEAD_OPTIONS.includes(stored) ? stored : DEFAULT_AUTO_ETO_LOOKAHEAD_MIN\n    } catch {\n      return DEFAULT_AUTO_ETO_LOOKAHEAD_MIN\n    }\n  })\n  const lastActivityRef = useRef(Date.now())`,
  'lookahead state',
)

tsx = replaceOnce(
  tsx,
  `  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.toUpperCase())), [existingCallsigns])\n\n  const setDraftState`,
  `  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.toUpperCase())), [existingCallsigns])\n\n  useEffect(() => {\n    try { window.localStorage.setItem(AUTO_ETO_LOOKAHEAD_STORAGE_KEY, String(lookaheadMin)) } catch { /* ignore storage failures */ }\n  }, [lookaheadMin])\n\n  const setDraftState`,
  'lookahead persistence',
)

tsx = replaceOnce(
  tsx,
  `        const estimate = autoEstimate(flight, geometry, refFix, gs, nextFetchedAt)`,
  `        const estimate = autoEstimate(flight, geometry, refFix, gs, nextFetchedAt, lookaheadMin)`,
  'refresh autoEstimate',
)

tsx = replaceOnce(
  tsx,
  `  }, [airport, fixes, getRouteGeometry, setDraftState, smoothedGroundSpeed])`,
  `  }, [airport, fixes, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed])`,
  'refresh dependencies',
)

tsx = replaceOnce(
  tsx,
  `    const estimate = autoEstimate(flight, geometry, refFix, gs, fetchedAt || new Date().toISOString())`,
  `    const estimate = autoEstimate(flight, geometry, refFix, gs, fetchedAt || new Date().toISOString(), lookaheadMin)`,
  'manual ref fix autoEstimate',
)

tsx = replaceOnce(
  tsx,
  `  const manualRefresh = () => {\n    lastActivityRef.current = Date.now()\n    idleRef.current = false\n    setIdle(false)\n    void refresh()\n  }\n\n  const changeRefFix`,
  `  const manualRefresh = () => {\n    lastActivityRef.current = Date.now()\n    idleRef.current = false\n    setIdle(false)\n    void refresh()\n  }\n\n  const changeLookahead = (minutes: number) => {\n    if (!AUTO_ETO_LOOKAHEAD_OPTIONS.includes(minutes)) return\n    setLookaheadMin(minutes)\n  }\n\n  useEffect(() => {\n    if (open) void refresh()\n  }, [lookaheadMin])\n\n  const changeRefFix`,
  'lookahead refresh effect',
)

tsx = replaceOnce(
  tsx,
  `            <span>AUTO ETO uses filed-route distance + live GS when estimated arrival is within {AUTO_ETO_LOOKAHEAD_MIN} minutes. Manual override remains available.</span>\n          </div>\n          <button type="button" onClick={manualRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>`,
  `            <span>AUTO ETO uses filed-route distance + live GS when estimated arrival is inside the selected ETA window. Manual override remains available.</span>\n          </div>\n          <div className="ivao-traffic-heading-actions">\n            <label className="ivao-lookahead-control"><span>START AUTO ETO</span><select value={lookaheadMin} onChange={(event) => changeLookahead(Number(event.target.value))}>{AUTO_ETO_LOOKAHEAD_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>ETA ≤ {minutes} min</option>)}</select></label>\n            <button type="button" onClick={manualRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>\n          </div>`,
  'heading controls',
)

tsx = replaceOnce(
  tsx,
  `{estimateText(estimate, draft.etoManual)}`,
  `{estimateText(estimate, draft.etoManual, lookaheadMin)}`,
  'estimate text call',
)

tsx = replaceOnce(
  tsx,
  `          <span>{fetchedAt ? \`Updated \${new Date(fetchedAt).toISOString().slice(11, 19)}Z\` : 'Waiting for IVAO data'} · AUTO ETO is a planning estimate</span>`,
  `          <span>{fetchedAt ? \`Updated \${new Date(fetchedAt).toISOString().slice(11, 19)}Z\` : 'Waiting for IVAO data'} · AUTO ETO window {lookaheadMin} min · planning estimate</span>`,
  'footer lookahead',
)

fs.writeFileSync(tsxPath, tsx)

const cssPath = 'src/ivaoTraffic.css'
let css = fs.readFileSync(cssPath, 'utf8')
css = replaceOnce(
  css,
  `.ivao-traffic-heading span { display: block; margin-top: 2px; color: #7f899a; font-size: 10px; }\n.ivao-traffic-heading button {`,
  `.ivao-traffic-heading span { display: block; margin-top: 2px; color: #7f899a; font-size: 10px; }\n.ivao-traffic-heading-actions { display: flex; align-items: end; gap: 8px; flex: 0 0 auto; }\n.ivao-lookahead-control span { margin: 0 0 3px 2px; color: #7f899a; font-size: 8px; font-weight: 800; letter-spacing: .05em; }\n.ivao-lookahead-control select { height: 30px; border: 1px solid #dfe5ee; border-radius: 9px; background: #f8fbff; color: #244a84; padding: 0 8px; font-size: 10px; font-weight: 750; outline: none; }\n.ivao-lookahead-control select:focus { border-color: #8aacef; box-shadow: 0 0 0 3px rgba(45,105,207,.08); }\n.ivao-traffic-heading button {`,
  'lookahead css',
)
fs.writeFileSync(cssPath, css)
