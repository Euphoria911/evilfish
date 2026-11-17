// Offline check of the fast-mode search policy with the real engine (Stockfish 19 full, single thread).
// For a set of middlegame positions: reference = 3 s search; A = plain 300 ms; B = the script's policy
// (300 ms budget, early stop when settled, +150 ms once when unsettled). Reports agreement with the reference
// (best-move match and score loss measured by the reference) and average time.
const { spawn } = require('child_process');
const { Chess } = require('chess.js');
const { load } = require('../test/harness.js');
const { T } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));

const ENGINE = require('path').join(__dirname, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19-single.js');
const N = +process.argv[2] || 100;
const BUDGET = +process.env.BUDGET || 300;
const EXT = process.env.EXT === '1';

class Engine {
  constructor() {
    this.p = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.waiters = [];
    this.p.stdout.on('data', d => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.waiters.slice().forEach(w => w(line)); }
    });
  }
  send(c) { this.p.stdin.write(c + '\n'); }
  until(test, onLine) {
    return new Promise(res => { const w = line => { if (onLine) onLine(line); if (test(line)) { this.waiters = this.waiters.filter(x => x !== w); res(line); } }; this.waiters.push(w); });
  }
  async init() { this.send('uci'); await this.until(l => l === 'uciok'); this.send('setoption name Hash value 128'); this.send('setoption name MultiPV value 1'); this.send('isready'); await this.until(l => l === 'readyok'); }
  async search(fen, goCmd, stopRule) {
    this.send('ucinewgame'); this.send('position fen ' + fen);
    const hist = []; const t0 = Date.now(); let stopped = false;
    this.send(goCmd);
    const last = await this.until(l => l.startsWith('bestmove'), line => {
      const m = line.match(/^info depth (\d+).* score (cp|mate) (-?\d+).* pv (\S+)/);
      if (m && !/(lowerbound|upperbound)/.test(line)) {
        const cp = m[2] === 'cp' ? +m[3] : (+m[3] > 0 ? 10000 - +m[3] : -10000 - +m[3]);
        hist.push({ depth: +m[1], move: m[4], cp });
        if (stopRule && !stopped && stopRule(hist, Date.now() - t0)) { stopped = true; this.send('stop'); }
      }
    });
    return { best: last.split(' ')[1], ms: Date.now() - t0, hist };
  }
}

const settled = (h, ms, budget) => {
  const x = h.slice(-4);
  if (x.length < 4 || x[3].depth < 14 || ms < budget * 0.4) return false;
  if (!x.every(e => e.move === x[0].move)) return false;
  const cps = x.map(e => e.cp);
  return Math.max(...cps) - Math.min(...cps) <= 12;
};

(async () => {
  // positions: middlegame positions from the repertoire lines (plies 14-30), deterministic sample
  const fens = [];
  for (const op of T.OPENINGS) for (const line of op.lines) {
    const g = new Chess(); const mv = line.split(' ');
    for (let i = 0; i < mv.length; i++) { g.move({ from: mv[i].slice(0, 2), to: mv[i].slice(2, 4), promotion: mv[i][4] }); if (i >= 13 && i % 3 === 0 && g.moves().length >= 8) fens.push(g.fen()); }
  }
  // extend with random continuations so we get genuinely un-booked positions
  let s = 20240229; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const extra = [];
  for (const f of fens.slice()) { const g = new Chess(f); for (let k = 0; k < 6 && !g.isGameOver(); k++) { const m = g.moves(); g.move(m[Math.floor(rnd() * m.length)]); } if (!g.isGameOver() && g.moves().length >= 8) extra.push(g.fen()); }
  const all = [...new Set([...fens, ...extra])].sort(() => rnd() - 0.5).slice(0, N);
  console.log('positions', all.length);

  const e = new Engine(); await e.init();
  let agreeA = 0, agreeB = 0, msA = 0, msB = 0, ext = 0, extFixed = 0, lossA = 0, lossB = 0, n = 0;
  for (const fen of all) {
    const ref = await e.search(fen, 'go movetime 3000');
    const refEval = ref.hist.length ? ref.hist[ref.hist.length - 1].cp : 0;
    const a = await e.search(fen, 'go movetime ' + BUDGET);
    // policy B: 300 ms budget with early stop
    let b = await e.search(fen, 'go depth 40 movetime ' + BUDGET, (h, ms) => settled(h, ms, BUDGET));
    let bms = b.ms, bbest = b.best;
    const unsettled = EXT && T.unsettled(b.hist);
    if (unsettled) { ext++; const b2 = await e.search(fen, 'go depth 40 movetime ' + Math.round(BUDGET * 0.7)); bms += b2.ms; bbest = b2.best; if (bbest !== b.best && bbest === ref.best) extFixed++; }
    n++;
    msA += a.ms; msB += bms;
    if (a.best === ref.best) agreeA++;
    if (bbest === ref.best) agreeB++;
    // score loss as judged by the reference: re-evaluate the chosen move quickly with the reference engine (depth-limited child eval)
    if (process.env.LOSS) {
      for (const [mv, tag] of [[a.best, 'A'], [bbest, 'B']]) {
        if (mv === ref.best) continue;
        const g = new Chess(fen); g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] });
        const r = await e.search(g.fen(), 'go movetime 1500');
        const cpChild = r.hist.length ? -r.hist[r.hist.length - 1].cp : 0;
        const loss = Math.max(0, refEval - cpChild);
        if (tag === 'A') lossA += loss; else lossB += loss;
      }
    }
    if (n % 20 === 0) console.log(`${n}/${all.length}  agree A ${(100 * agreeA / n).toFixed(0)}%  B ${(100 * agreeB / n).toFixed(0)}%  avg ms A ${Math.round(msA / n)} B ${Math.round(msB / n)}  extended ${ext}`);
  }
  console.log({ positions: n, agreeWithReference_plain300: (100 * agreeA / n).toFixed(1) + '%', agreeWithReference_policy: (100 * agreeB / n).toFixed(1) + '%',
                avgMs_plain300: Math.round(msA / n), avgMs_policy: Math.round(msB / n), extendedPositions: ext, extensionFixedAMiss: extFixed,
                avgCpLoss_plain300: process.env.LOSS ? Math.round(lossA / n) : 'n/a', avgCpLoss_policy: process.env.LOSS ? Math.round(lossB / n) : 'n/a' });
  e.p.kill();
})();
