const fs = require('fs');

function replace(path, from, to) {
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes(from)) throw new Error(`Pattern not found in ${path}: ${from}`);
  s = s.replaceAll(from, to);
  fs.writeFileSync(path, s);
}

replace('src/timeWorkflow.ts', "[TIME_COLUMNS.cldt, 'SEQUENCE', 'Starts at ELDT; controller may override for sequencing.']", "[TIME_COLUMNS.cldt, 'TARGET', 'Target Landing Time. Starts at ELDT; controller may override for sequencing.']");
replace('src/timeWorkflow.ts', '<span><b>TLDT</b><small>SEQUENCE</small></span>', '<span><b>TLDT</b><small>TARGET</small></span>');
replace('README.md', '| `TLDT` | Calculated / planned Landing Time |', '| `TLDT` | Target Landing Time |');
replace('README.md', '  - TLDT = SEQUENCE;', '  - TLDT = TARGET;');

for (const p of ['scripts/patch-tldt-target-label.cjs', '.github/workflows/patch-tldt-target-label.yml']) if (fs.existsSync(p)) fs.unlinkSync(p);
