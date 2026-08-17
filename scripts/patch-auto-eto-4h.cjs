const fs = require('fs');

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing ${label}`)
  return text.replace(from, to)
}

let tsx = fs.readFileSync('src/IvaoTrafficPanel.tsx', 'utf8')
tsx = replaceOnce(
  tsx,
  'const AUTO_ETO_LOOKAHEAD_OPTIONS = [30, 45, 60, 90, 120]',
  'const AUTO_ETO_LOOKAHEAD_OPTIONS = [30, 45, 60, 90, 120, 180, 240]',
  'AUTO_ETO_LOOKAHEAD_OPTIONS',
)
fs.writeFileSync('src/IvaoTrafficPanel.tsx', tsx)

let readme = fs.readFileSync('README.md', 'utf8')
readme = replaceOnce(
  readme,
  '- ETA ≤ 120 min',
  '- ETA ≤ 120 min\n- ETA ≤ 180 min\n- ETA ≤ 240 min (4 hours)',
  'README look-ahead options',
)
readme = readme.replace('selected 30 / 45 / 60 / 90 / 120 min window', 'selected 30 / 45 / 60 / 90 / 120 / 180 / 240 min window')
fs.writeFileSync('README.md', readme)

for (const path of ['scripts/patch-auto-eto-4h.cjs', '.github/workflows/patch-auto-eto-4h.yml']) {
  if (fs.existsSync(path)) fs.rmSync(path)
}
