// Packs theory_book.json into the userscript (THEORY_DATA) and applies the validated repertoire lines.
// usage: node build_theory.js <theory.json> [lines_validated.json] [target script]
const fs = require('fs');
const { load } = require('../test/harness.js');
const theoryFile = process.argv[2] || require('path').join(__dirname, '..', 'data', 'theory_book.json');
const linesFile = process.argv[3] || '';
const target = process.argv[4] || require('path').join(__dirname, '..', 'evilfish.user.js');

const { T } = load(target);                      // uses the script's own hash so the two can never disagree
const entries = JSON.parse(fs.readFileSync(theoryFile, 'utf8'));
const seen = new Map();
let collisions = 0, badMove = 0;
for (const [key, move] of entries) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) { badMove++; continue; }
  const h = T.hashKey(key);
  if (seen.has(h) && seen.get(h) !== move) { collisions++; continue; }
  seen.set(h, move);
}
let data = '';
for (const [h, mv] of seen) data += h + mv.padEnd(5, '_');
console.log(`theory entries ${entries.length} -> ${seen.size} packed (${collisions} hash conflicts, ${badMove} bad), ${data.length} chars`);

let src = fs.readFileSync(target, 'utf8');
src = src.replace(/\/\*THEORY_BEGIN\*\/'[^']*'\/\*THEORY_END\*\//, () => `/*THEORY_BEGIN*/'${data}'/*THEORY_END*/`);

if (linesFile && fs.existsSync(linesFile)) {
  const validated = JSON.parse(fs.readFileSync(linesFile, 'utf8'));
  const start = src.indexOf('  const OPENINGS = [');
  const end = src.indexOf('\n  ];', start) + 5;
  const block = src.slice(start, end);
  let changed = 0;
  const out = block.split('\n').map(line => {
    const m = line.match(/^(\s*\{ name: )"([^"]+)"(, side: "[wb]", lines: )\[(.*)\](\s*\}[,]?)$/);
    if (!m || !validated[m[2]]) return line;
    changed++;
    return `${m[1]}"${m[2]}"${m[3]}[${validated[m[2]].map(l => JSON.stringify(l)).join(',')}]${m[5]}`;
  }).join('\n');
  src = src.slice(0, start) + out + src.slice(end);
  console.log(`repertoire lines rewritten for ${changed} openings`);
}
fs.writeFileSync(target, src);
console.log('written', target, src.length, 'bytes');
