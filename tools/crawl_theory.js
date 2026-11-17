// Builds the offline theory book: for each colour, the best move (lichess cloud-eval, depth 35-75) in every
// likely opening position, reached by following what players actually play (lichess explorer, 1600-2200 rated).
// Most likely branches first; common gambits and sidelines are seeded explicitly. Sequential, paced, resumable.
const fs = require('fs');
const { Chess } = require('chess.js');

const CACHE_FILE = process.env.CACHE_FILE || 'crawl_cache.json';
const OUT_FILE = process.argv[2] || require('path').join(__dirname, '..', 'data', 'theory_book.json');
const CALL_BUDGET = +process.argv[3] || 1700;          // per colour
const PACE_MS = 320;
const MAX_PLY = +process.env.MAX_PLY || 26;
const MIN_WEIGHT = +process.env.MIN_WEIGHT || 0.0015;
const SHARE_MIN = +process.env.SHARE_MIN || 0.03;

let cache = { explorer: {}, cloud: {} };
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}
let dirty = 0;
const save = () => { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = fen => fen.split(' ').slice(0, 4).join(' ');
const bookKey = fen => fen.split(' ').slice(0, 3).join(' ');   // placement side castling (same as the userscript)
let calls = 0, hits = 0;

async function http(url) {
  const pace = url.includes("explorer.lichess") ? (+process.env.PACE_EXPLORER || 450) : (+process.env.PACE_CLOUD || 1400);
  for (let i = 0; i < 6; i++) {
    await sleep(pace);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.status === 429) { console.log('429 - waiting 90s'); await sleep(90000); continue; }
      if (r.status === 404) return null;
      if (!r.ok) { await sleep(3000); continue; }
      return await r.json();
    } catch (e) { await sleep(3000); }
  }
  return undefined;
}

// king-takes-rook castling (lichess) -> two-square castling (chess.com / UCI standard)
function normCastle(fen, uci) {
  const c = new Chess(fen);
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const p = c.get(from), t = c.get(to);
  if (p && p.type === 'k' && t && t.type === 'r' && t.color === p.color) return from + (to[0] > from[0] ? 'g' : 'c') + from[1];
  return uci;
}

async function explorer(fen) {
  const k = keyOf(fen);
  if (k in cache.explorer) { hits++; return cache.explorer[k]; }
  calls++;
  const d = await http('https://explorer.lichess.ovh/lichess?variant=standard&speeds=blitz,rapid,classical&ratings=1600,1800,2000,2200&moves=10&topGames=0&recentGames=0&fen=' + encodeURIComponent(fen));
  let res = null;
  if (d) res = { total: d.white + d.draws + d.black, moves: d.moves.map(m => ({ uci: normCastle(fen, m.uci), total: m.white + m.draws + m.black })) };
  if (d !== undefined) { cache.explorer[k] = res; if (++dirty >= 25) save(); }
  return res;
}

const cloudsrc = require('./cloudsrc.js');
async function cloud(fen) { calls++; return cloudsrc.get(fen, cache, () => { if (++dirty >= 25) save(); }); }

// side-to-move point of view from a White-POV cloud score
const pov = (turn, p) => (p.mate != null ? (p.mate > 0 ? 10000 - p.mate : -10000 - p.mate) : p.cp) * (turn === 'w' ? 1 : -1);

// seeds: opponent moves (UCI) to force into the tree, in order, whatever my own replies are
const SEEDS_VS_WHITE = [   // I am Black; White plays these
  ['e2e4', 'f2f4'], ['e2e4', 'd2d4', 'f2f4'], ['e2e4', 'g1f3', 'f1c4', 'b2b4'], ['e2e4', 'g1f3', 'd2d4', 'f1c4'],
  ['e2e4', 'b1c3', 'f2f4'], ['e2e4', 'b2b4'], ['e2e4', 'd2d4', 'c2c3'], ['e2e4', 'f2f4'],
  ['e2e4', 'd2d4', 'e4e5'], ['e2e4', 'd2d4', 'b1c3'], ['e2e4', 'd2d4', 'b1d2'], ['e2e4', 'd2d4', 'f2f3'],
  ['e2e4', 'd2d4', 'c2c3'], ['d2d4', 'e2e4'], ['d2d4', 'c2c4', 'b1c3'], ['d2d4', 'c1f4'], ['d2d4', 'c1g5'],
  ['d2d4', 'g1f3', 'c1f4'], ['d2d4', 'g1f3', 'c1g5'], ['d2d4', 'g2g3'], ['g1f3', 'c2c4'], ['g1f3', 'g2g3'],
  ['c2c4', 'g1f3'], ['c2c4', 'b1c3'], ['b2b3'], ['f2f4'], ['g2g4'], ['b1c3'], ['e2e4', 'b1c3', 'g1f3'], ['e2e4', 'g1f3', 'f1b5'],
  ['e2e4', 'g1f3', 'b1c3'], ['e2e4', 'c2c3'], ['e2e4', 'd2d3'], ['e2e4', 'f1c4'], ['e2e4', 'g1f3', 'f1c4', 'c2c3'],
  ['d2d4', 'c2c4', 'e2e4'], ['d2d4', 'c2c4', 'g1f3', 'g2g3'], ['d2d4', 'e2e3'], ['e2e4', 'f2f4', 'g1f3'],
];
const SEEDS_VS_BLACK = [   // I am White; Black plays these
  ['d7d5', 'e7e5'], ['d7d5', 'c7c6'], ['d7d5', 'e7e6'], ['g8f6', 'e7e5'], ['g8f6', 'c7c5', 'b7b5'], ['g8f6', 'c7c5', 'e7e6'],
  ['e7e5', 'f7f5'], ['e7e5', 'g8f6', 'f7f5'], ['e7e5', 'b8c6', 'g8f6'], ['e7e5', 'd7d5'], ['e7e5', 'g8f6', 'd7d5'],
  ['f7f5'], ['d7d6', 'g8f6'], ['g7g6', 'f8g7'], ['b7b6'], ['a7a6'], ['b8c6'], ['c7c6', 'd7d5'], ['c7c5', 'b8c6'],
  ['c7c5', 'e7e6'], ['c7c5', 'g7g6'], ['e7e6', 'd7d5'], ['d7d5', 'g8f6'], ['d7d5', 'c7c5'], ['d7d5', 'b8c6'],
  ['g8f6', 'e7e6', 'f8b4'], ['g8f6', 'g7g6', 'f8g7'], ['g8f6', 'd7d5', 'c8f5'], ['d7d5', 'c8f5'], ['d7d5', 'g8f6', 'c8f5'],
  ['e7e5', 'g8f6', 'f6e4'], ['e7e5', 'b8c6', 'f8c5'], ['e7e5', 'b8c6', 'g8f6', 'f6e4'], ['g8f6', 'e7e5', 'f8b4'],
  ['d7d5', 'e7e5', 'b8c6'], ['d7d5', 'c7c6', 'c8f5'], ['d7d5', 'e7e6', 'c7c5'], ['g8f6', 'b7b6'], ['d7d6'], ['g7g6'],
];

const root = new Chess().fen();

async function build(me) {
  const mine = new Map();       // bookKey -> move
  const seen = new Set();       // visited (placement side castling) to avoid re-expanding transpositions
  const queue = [{ fen: root, ply: 0, w: 1, seeds: [] }];
  const seedList = me === 'b' ? SEEDS_VS_WHITE : SEEDS_VS_BLACK;
  // seed nodes get a floor weight so they are explored (shallowly) even though they are rare
  for (const s of seedList) queue.push({ fen: root, ply: 0, w: 0.02, seeds: s.slice(), seedRun: true });
  const startCalls = calls;
  let processed = 0;
  while (queue.length && calls - startCalls < CALL_BUDGET) {
    queue.sort((a, b) => b.w - a.w);
    const n = queue.shift();
    if (n.w < MIN_WEIGHT || n.ply >= MAX_PLY) continue;
    const g = new Chess(n.fen);
    if (g.isGameOver()) continue;
    const turn = g.turn();
    const bk = bookKey(n.fen);
    processed++;
    if (turn === me) {
      let move = mine.get(bk);
      if (!move) {
        if (seen.has('m' + bk)) continue;
        const cl = await cloud(n.fen);
        if (cl && cl.pvs.length) {
          const best = pov(turn, cl.pvs[0]);
          const ex = await explorer(n.fen);
          const pop = u => (ex ? (ex.moves.find(m => m.uci === u) || { total: 0 }).total : 0);
          // among near-equal engine moves prefer the one players actually reach in theory
          const pool = cl.pvs.filter(p => pov(turn, p) >= best - 12);
          pool.sort((a, b) => pop(b.move) - pop(a.move));
          move = pool[0].move;
          if (Math.abs(best) > 400 && n.ply > 8) { mine.set(bk, move); continue; }   // decided: stop growing
        } else {
          const ex = await explorer(n.fen);
          if (ex && ex.moves.length && ex.total > 400) move = ex.moves[0].uci;
        }
        if (!move) continue;
        const legal = g.moves({ verbose: true }).some(m => m.from + m.to + (m.promotion || '') === move);
        if (!legal) { console.log('illegal candidate dropped', n.fen, move); continue; }
        mine.set(bk, move);
        seen.add('m' + bk);
      }
      const c = new Chess(n.fen);
      c.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
      queue.push({ fen: c.fen(), ply: n.ply + 1, w: n.w, seeds: n.seeds, seedRun: n.seedRun });
    } else {
      if (seen.has('o' + bk) && !n.seedRun) continue;
      seen.add('o' + bk);
      const ex = await explorer(n.fen);
      const cand = [];
      if (ex && ex.total >= 150) {
        const limit = n.ply < 6 ? 5 : n.ply < 12 ? 4 : 3;
        for (const m of ex.moves.slice(0, limit)) {
          const share = m.total / ex.total;
          if (share >= SHARE_MIN) cand.push({ uci: m.uci, share });
        }
      }
      if (n.seedRun && n.seeds.length) {
        const s = n.seeds.shift();
        if (g.moves({ verbose: true }).some(m => m.from + m.to + (m.promotion || '') === s) && !cand.some(c => c.uci === s)) cand.push({ uci: s, share: 0.05 });
        else if (!g.moves({ verbose: true }).some(m => m.from + m.to + (m.promotion || '') === s)) { n.seeds.length = 0; }
        // follow only the seeded move on a seed run
        const only = cand.filter(c => c.uci === s);
        cand.length = 0; cand.push(...only);
      }
      for (const c of cand) {
        const g2 = new Chess(n.fen);
        try { g2.move({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci[4] }); } catch (e) { continue; }
        queue.push({ fen: g2.fen(), ply: n.ply + 1, w: n.w * c.share, seeds: n.seedRun ? n.seeds.slice() : [], seedRun: n.seedRun && n.seeds.length > 0 });
      }
    }
    if (processed % 100 === 0) console.log(`[${me}] processed ${processed}, my positions ${mine.size}, queue ${queue.length}, calls ${calls - startCalls}/${CALL_BUDGET}`);
  }
  console.log(`[${me}] done: my positions ${mine.size}, calls ${calls - startCalls}, cache hits ${hits}`);
  return mine;
}

(async () => {
  const out = [];
  for (const me of ['w', 'b']) {
    const m = await build(me);
    save();
    for (const [k, mv] of m) out.push([k, mv]);
  }
  // final validation: every move must be legal in its position
  let bad = 0;
  const good = out.filter(([k, mv]) => {
    try {
      const g = new Chess(k + ' - 0 1');
      const ok = g.moves({ verbose: true }).some(m => m.from + m.to + (m.promotion || '') === mv);
      if (!ok) bad++;
      return ok;
    } catch (e) { bad++; return false; }
  });
  fs.writeFileSync(OUT_FILE, JSON.stringify(good));
  save();
  console.log(`wrote ${good.length} entries (${bad} dropped) to ${OUT_FILE}; calls made ${calls}, cache hits ${hits}; eval sources `+JSON.stringify(cloudsrc.stats)); cloudsrc.stop();
})();
