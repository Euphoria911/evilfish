const fs = require('fs'); const pre = process.argv[2] || 'lad1_';
const rows = [];
for (const f of fs.readdirSync('.').filter(f => f.startsWith(pre) && f.endsWith('.log'))) {
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8').trim().split('\n').pop()); const n = j.aWins + j.draws + j.aLosses; const sc = (j.aWins + j.draws / 2) / n;
    rows.push({ label: j.label, w: j.aWins, d: j.draws, l: j.aLosses, n, sc, elo: Math.round(-400 * Math.log10(1 / Math.max(.001, Math.min(.999, sc)) - 1)) }); } catch (e) {}
}
rows.sort((a, b) => b.elo - a.elo);
for (const r of rows) console.log(r.label.padEnd(10), `${r.w}-${r.d}-${r.l}`.padEnd(9), 'of', r.n, 'score', r.sc.toFixed(3), `~${r.elo >= 0 ? '+' : ''}${r.elo} vs yardstick`);
console.log(rows.length + ' finished');
