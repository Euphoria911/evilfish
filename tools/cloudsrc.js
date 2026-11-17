// One place for "best moves in this position": lichess cloud-eval when it answers, else the local Stockfish.
const { Chess } = require('chess.js');
const local = require('./localeval.js');
let blockedUntil = 0;
const stats = { cloud: 0, local: 0, cached: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = fen => fen.split(' ').slice(0, 4).join(' ');

function normCastle(fen, uci) {
  const c = new Chess(fen);
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const p = c.get(from), t = c.get(to);
  if (p && p.type === 'k' && t && t.type === 'r' && t.color === p.color) return from + (to[0] > from[0] ? 'g' : 'c') + from[1];
  return uci;
}

async function get(fen, cache, onNew) {
  const k = keyOf(fen);
  if (k in cache.cloud && cache.cloud[k] !== null) { stats.cached++; return cache.cloud[k]; }
  let res = null;
  if (Date.now() >= blockedUntil) {
    await sleep(+process.env.PACE_CLOUD || 700);
    try {
      const r = await fetch('https://lichess.org/api/cloud-eval?multiPv=5&fen=' + encodeURIComponent(fen));
      if (r.status === 429) { blockedUntil = Date.now() + 20 * 60000; console.log('cloud 429: using the local engine for 20 minutes'); }
      else if (r.status === 200) {
        const d = await r.json();
        res = { depth: d.depth, pvs: d.pvs.map(p => ({ move: normCastle(fen, p.moves.split(' ')[0]), cp: p.cp, mate: p.mate })) };
        stats.cloud++;
      }
    } catch (e) { blockedUntil = Date.now() + 2 * 60000; }
  }
  if (!res) {
    const ev = await local.evalFen(fen, +process.env.LOCAL_MS || 900);
    res = { depth: ev.depth, local: true, pvs: ev.pvs.map(p => ({ move: normCastle(fen, p.move), cp: p.cp, mate: p.mate })) };
    stats.local++;
  }
  cache.cloud[k] = res;
  if (onNew) onNew();
  return res;
}
module.exports = { get, stats, stop: local.stop };
