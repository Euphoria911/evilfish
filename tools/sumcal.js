const fs = require('fs');
const tag = process.argv[2] || 'first';
const by = {};
for (const f of fs.readdirSync('.').filter(f => f.startsWith(`cal_${tag}_t`) && f.endsWith('.log'))) {
  const t = fs.readFileSync(f, 'utf8').trim().split('\n').pop();
  try { const j = JSON.parse(t); (by[j.tier] = by[j.tier] || []).push(j); } catch (e) {}
}
for (const t of Object.keys(by).sort()) {
  const a = by[t]; const w = a.reduce((x, y) => x + y.wins, 0), d = a.reduce((x, y) => x + y.draws, 0), l = a.reduce((x, y) => x + y.losses, 0), n = w + d + l;
  const score = (w + d / 2) / n; const elo = Math.round(-400 * Math.log10(1 / Math.max(0.001, Math.min(0.999, score)) - 1));
  const hh = (a.reduce((x, y) => x + parseFloat(y.humanHangRate), 0) / a.length).toFixed(2), rh = (a.reduce((x, y) => x + parseFloat(y.refHangRate), 0) / a.length).toFixed(2);
  console.log(`tier ${t} (${a.length}/2 files) ${JSON.stringify(a[0].params)}: ${w}-${d}-${l} of ${n}  score ${score.toFixed(3)}  ~${elo >= 0 ? '+' : ''}${elo} Elo vs UCI tier  | hanging-piece moves: human ${hh}% vs reference ${rh}%`);
}
