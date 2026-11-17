// Checks every repertoire move against deep cloud evals. Each opening keeps its defining moves (identity prefix);
// after that, a line is cut right before the first move of mine that is objectively unsound.
const fs = require('fs');
const { Chess } = require('chess.js');
const { load } = require('../test/harness.js');
const { T } = load(process.argv[2] || require('path').join(__dirname, '..', 'evilfish.user.js'));

const CACHE_FILE = process.env.CACHE_FILE || 'crawl_cache.json';
const LOSS_LIMIT = +process.argv[3] || 70;        // centipawns worse than the best move
const IDENTITY_MAX = 8;                           // plies
let cache = { explorer: {}, cloud: {} };
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = fen => fen.split(' ').slice(0, 4).join(' ');
let calls = 0, dirty = 0;
const save = () => { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = 0; };

function normCastle(fen, uci) {
  const c = new Chess(fen);
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const p = c.get(from), t = c.get(to);
  if (p && p.type === 'k' && t && t.type === 'r' && t.color === p.color) return from + (to[0] > from[0] ? 'g' : 'c') + from[1];
  return uci;
}
const cloudsrc = require('./cloudsrc.js');
async function cloud(fen) { calls++; return cloudsrc.get(fen, cache, () => { if (++dirty >= 25) save(); }); }
const pov = (turn, p) => (p.mate != null ? (p.mate > 0 ? 10000 - p.mate : -10000 - p.mate) : p.cp) * (turn === 'w' ? 1 : -1);

(async () => {
  const report = [], result = {};
  for (const op of T.OPENINGS) {
    if (!op.side) continue;
    const lines = op.lines.map(l => l.split(' '));
    let common = 0;
    while (lines.every(l => l[common] && l[common] === lines[0][common])) common++;
    const identity = Math.min(common, IDENTITY_MAX);
    let checked = 0, flagged = 0, unknown = 0;
    const examples = [];
    const newLines = [];
    for (const moves of lines) {
      const g = new Chess();
      let cutAt = moves.length;
      for (let ply = 0; ply < moves.length; ply++) {
        const side = ply % 2 ? 'b' : 'w';
        const mv = moves[ply];
        if (side === op.side && ply >= identity) {
          const fen = g.fen();
          const cl = await cloud(fen);
          checked++;
          if (cl === undefined) unknown++;
          else if (cl && cl.pvs.length) {
            const best = pov(side, cl.pvs[0]);
            const hit = cl.pvs.find(p => p.move === mv);
            let loss = hit ? best - pov(side, hit) : null;
            if (loss === null) {
              // not among the engine's top five: measure what the move actually costs by evaluating the position after it
              const g2 = new Chess(fen); g2.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] });
              const child = await cloud(g2.fen());
              loss = child && child.pvs.length ? best - pov(side, child.pvs[0]) : 0;
            }
            if (loss > LOSS_LIMIT) {
              flagged++;
              if (examples.length < 4) examples.push(`ply ${ply + 1} ${mv} (loses ${Math.round(loss)}cp), best ${cl.pvs[0].move}`);
              cutAt = ply;
              break;
            }
          } else unknown++;
        }
        g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] });
      }
      // keep the line up to the unsound move; make sure the cut leaves it ending on the opponent's move
      let kept = moves.slice(0, cutAt);
      if (kept.length < identity) kept = moves.slice(0, identity);
      if (kept.length) newLines.push(kept.join(' '));
    }
    // de-duplicate lines that became identical or are prefixes of another
    const uniq = [...new Set(newLines)].filter(a => !newLines.some(b => b !== a && b.startsWith(a + ' ')));
    result[op.name] = uniq;
    report.push(`${op.name.padEnd(34)} identity ${identity} plies, my moves checked ${String(checked).padStart(3)}, cut ${flagged}, unknown ${unknown}, lines ${op.lines.length} -> ${uniq.length}` + (examples.length ? '\n    ' + examples.join('\n    ') : ''));
    console.log(report[report.length - 1]);
    save();
  }
  fs.writeFileSync(require('path').join(__dirname, '..', 'data', 'lines_validated.json'), JSON.stringify(result, null, 1));
  fs.writeFileSync(require('path').join(__dirname, '..', 'data', 'lines_report.txt'), report.join('\n'));
  save();
  console.log('done; eval calls', calls, JSON.stringify(cloudsrc.stats)); cloudsrc.stop();
})();
