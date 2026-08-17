const fs = require('fs');
const path = require('path');

const roots = ['src', 'README.md'];
const exts = new Set(['.ts','.tsx','.js','.jsx','.css','.md','.html']);

function filesUnder(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((name) => filesUnder(path.join(target, name)));
}

const files = roots.flatMap(filesUnder).filter((file) => file === 'README.md' || exts.has(path.extname(file)));
let changed = 0;
for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  text = text
    .replace(/Calculated Landing Time/g, 'Target Landing Time')
    .replace(/Calculated landing time/g, 'Target landing time')
    .replace(/calculated landing time/g, 'target landing time')
    .replace(/CLDT/g, 'TLDT')
    .replace(/TLDT SEQUENCE/g, 'TLDT TARGET');
  if (text !== before) {
    fs.writeFileSync(file, text);
    changed += 1;
    console.log('updated', file);
  }
}
console.log('changed files:', changed);
if (!changed) throw new Error('No TLDT terminology changes were applied');

for (const temp of ['scripts/patch-tldt-terminology.cjs', '.github/workflows/patch-tldt-terminology.yml']) {
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
}
