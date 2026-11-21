#!/usr/bin/env node
// Engine-vs-engine match with real clocks, for measuring strength and time policies.
//
//   node tools/strength_match.js --games 24 --parallel 2 --tc 60+0 \
//        --a '{"name":"bridge","bin":"multi","threads":8,"hash":512,"policy":"auto","overhead":40}' \
//        --b '{"name":"page","bin":"single","threads":1,"hash":128,"policy":"auto","overhead":5}'
//
// --tc          'movetime:500' (fixed time per move, no clock) or '<base seconds>+<increment seconds>' (e.g. 60+0, 180+2)
// side config   bin: multi | single | lite (the node_modules/stockfish builds) | native (the official build, ~/.local/bin/stockfish); threads; hash (MB);
//               policy: 'old' (clock/35, 4.2.x) | 'new' (moveBudget, 4.3.1) | 'native' (go wtime/btime/winc/binc);
//               overhead: ms added to every move (stands in for the bridge round trip and the page);
//               moveOverhead: the engine's own Move Overhead option (native policy)
// Games start from random 6-10 ply lines of the script's own repertoire; colours alternate on the same line.
// A game ends by mate, draw rules, flag, or adjudication (|eval| >= 1000 cp for 6 plies / dead-level after move 70).
const { spawn } = require('child_process');
const path = require('path');
const { Chess } = require('chess.js');
const { load } = require('../test/harness.js');
const { T } = load(path.join(__dirname, '..', 'evilfish.user.js'));

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const GAMES = +arg('games', 24), PAR = +arg('parallel', 2), TC = arg('tc', 'movetime:500');
const CA = JSON.parse(arg('a', '{"name":"A","bin":"multi","threads":8,"hash":512,"policy":"auto"}'));
const CB = JSON.parse(arg('b', '{"name":"B","bin":"single","threads":1,"hash":128,"policy":"auto"}'));
const SEED = +arg('seed', 1);
const BIN = { multi: 'stockfish-19.js', single: 'stockfish-19-single.js', lite: 'stockfish-19-lite-single.js' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Engine {
  constructor(cfg) {
    this.cfg = cfg;
    // bin: multi | single | lite are the WASM builds run by Node; bin: native is the official build (EF_ENGINE or ~/.local/bin/stockfish)
    this.p = cfg.bin === 'native'
      ? spawn(process.env.EF_ENGINE || path.join(require('os').homedir(), '.local', 'bin', 'stockfish'), [], { stdio: ['pipe', 'pipe', 'ignore'] })
      : spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'node_modules', 'stockfish', 'bin', BIN[cfg.bin])], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.waiters = [];
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); for (const w of this.waiters.slice()) w(l); } });
  }
  send(c) { this.p.stdin.write(c + '\n'); }
  until(test, on) { return new Promise(r => { const w = l => { if (on) on(l); if (test(l)) { this.waiters = this.waiters.filter(x => x !== w); r(l); } }; this.waiters.push(w); }); }
  async init() {
    this.send('uci'); await this.until(l => l === 'uciok');
    if (this.cfg.bin === 'multi' || this.cfg.bin === 'native') this.send(`setoption name Threads value ${this.cfg.threads || 1}`);
    this.send(`setoption name Hash value ${this.cfg.hash || 128}`);
    this.send(`setoption name Move Overhead value ${this.cfg.moveOverhead ?? 10}`);
    this.send('isready'); await this.until(l => l === 'readyok');
  }
  newGame() { this.send('ucinewgame'); }
  async go(startFEN, moves, goArgs) {
    this.send(`position fen ${startFEN}` + (moves.length ? ' moves ' + moves.join(' ') : ''));
    this.send('go ' + goArgs);
    let score = null, depth = 0;
    const last = await this.until(l => l.startsWith('bestmove'), l => {
      const m = l.match(/^info depth (\d+).* score (cp|mate) (-?\d+)/);
      if (m && !/bound/.test(l)) { depth = +m[1]; score = m[2] === 'cp' ? +m[3] : (+m[3] > 0 ? 10000 : -10000); }
    });
    return { best: last.split(' ')[1], score, depth };
  }
  quit() { try { this.send('quit'); this.p.kill(); } catch (e) {} }
}

// The two time policies of the userscript. 'old' is 4.2.x / 4.3.0 (clock/35, 250 ms cap under 25 s, a 260 ms pacing floor);
// 'new' is moveBudget() from the current script plus a pacing floor that follows the clock.
function movetimeFor(policy, clock, inc, plies) {
  if (policy === 'old') {
    let mt = clock < 8000 ? 120 : clock < 20000 ? 250 : Math.max(300, Math.min(6000, Math.round(clock / 35)));
    if (clock <= 25000) mt = Math.min(mt, 250);
    return mt;
  }
  return T.moveBudget(clock, inc, plies);
}
function paceFloorFor(policy, clock) {
  if (policy === 'old') return 260;
  if (policy === 'new') return clock < 3000 ? 0 : Math.min(260, clock * 0.03 + 40);
  return 0;
}

async function playGame(opening, aIsWhite, A, B, rng) {
  const chess = new Chess();
  const moves = [];
  for (const m of opening) { try { chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); moves.push(m); } catch (e) { break; } }
  const start = new Chess().fen();
  A.newGame(); B.newGame();
  const clocked = !TC.startsWith('movetime');
  let [base, inc] = clocked ? TC.split('+').map(Number) : [0, 0];
  const clock = { w: base * 1000, b: base * 1000 };
  const stats = { A: { n: 0, ms: 0 }, B: { n: 0, ms: 0 } };
  let result = null, reason = '', big = 0, flat = 0;
  while (!result) {
    if (chess.isCheckmate()) { result = chess.turn() === 'w' ? 'b' : 'w'; reason = 'mate'; break; }
    if (chess.isDraw() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) { result = 'd'; reason = 'draw'; break; }
    if (moves.length > 300) { result = 'd'; reason = 'length'; break; }
    const turn = chess.turn();
    const isA = (turn === 'w') === aIsWhite;
    const E = isA ? A : B, key = isA ? 'A' : 'B';
    const cfg = E.cfg, policy = cfg.policy || 'auto';
    let goArgs;
    if (!clocked) goArgs = `movetime ${+TC.split(':')[1]}`;
    else if (policy === 'native') goArgs = `wtime ${Math.max(1, Math.round(clock.w))} btime ${Math.max(1, Math.round(clock.b))} winc ${inc * 1000} binc ${inc * 1000}`;
    else goArgs = `movetime ${Math.max(20, Math.min(movetimeFor(policy, clock[turn], inc * 1000, moves.length), Math.round(clock[turn] - 50)))}`;
    const t0 = Date.now();
    const r = await E.go(start, moves, goArgs);
    if (cfg.overhead) await sleep(cfg.overhead);
    const floor = clocked ? paceFloorFor(policy, clock[turn]) : 0;
    const done = Date.now() - t0;
    if (floor > done) await sleep(floor - done);
    const spent = Date.now() - t0;
    stats[key].n++; stats[key].ms += spent;
    if (clocked) {
      clock[turn] -= spent;
      if (clock[turn] <= 0) { result = turn === 'w' ? 'b' : 'w'; reason = 'flag'; break; }
      clock[turn] += inc * 1000;
    }
    if (!r.best || r.best === '(none)') { result = 'd'; reason = 'nomove'; break; }
    // adjudication from the mover's own evaluation
    if (r.score !== null) {
      const mine = r.score;                              // side to move
      if (Math.abs(mine) >= 1000) { big = (big && Math.sign(mine) === big / Math.abs(big)) ? big + Math.sign(mine) : Math.sign(mine); }
      else big = 0;
      if (Math.abs(big) >= 6) { result = (big > 0) === (turn === 'w') ? 'w' : 'b'; reason = 'adj-win'; break; }
      if (moves.length > 70 && Math.abs(mine) <= 10) flat++; else flat = 0;
      if (flat >= 12) { result = 'd'; reason = 'adj-draw'; break; }
    }
    try { chess.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] }); } catch (e) { result = turn === 'w' ? 'b' : 'w'; reason = 'illegal'; break; }
    moves.push(r.best);
    if (process.env.EF_DEBUG && moves.length % 10 === 0) console.error(`  ply ${moves.length} ${key} ${r.best} d${r.depth} ${r.score} spent ${spent}ms clock ${Math.round(clock.w)}/${Math.round(clock.b)}`);
  }
  const aWin = result === 'd' ? 0.5 : ((result === 'w') === aIsWhite ? 1 : 0);
  return { aScore: aWin, reason, plies: moves.length, stats, clockLeft: clock };
}

(async () => {
  const lines = [];
  for (const op of T.OPENINGS) for (const l of op.lines) lines.push(l.split(' '));
  let s = SEED * 2654435761 >>> 0; const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const jobs = [];
  for (let p = 0; p < Math.ceil(GAMES / 2); p++) {
    const line = lines[Math.floor(rng() * lines.length)];
    const n = 6 + Math.floor(rng() * 5);
    jobs.push({ op: line.slice(0, n), aWhite: true }, { op: line.slice(0, n), aWhite: false });
  }
  jobs.length = GAMES;
  const out = { w: 0, d: 0, l: 0, reasons: {}, A: { n: 0, ms: 0 }, B: { n: 0, ms: 0 }, flagsA: 0, flagsB: 0 };
  let next = 0;
  const worker = async () => {
    const A = new Engine(CA), B = new Engine(CB);
    await A.init(); if (process.env.EF_DEBUG) console.error('A ready'); await B.init(); if (process.env.EF_DEBUG) console.error('B ready');
    for (;;) {
      const i = next++; if (i >= jobs.length) break;
      const g = await playGame(jobs[i].op, jobs[i].aWhite, A, B, rng);
      if (g.aScore === 1) out.w++; else if (g.aScore === 0) out.l++; else out.d++;
      out.reasons[g.reason] = (out.reasons[g.reason] || 0) + 1;
      if (g.reason === 'flag') { if (g.aScore === 0) out.flagsA++; else out.flagsB++; }
      for (const k of ['A', 'B']) { out[k].n += g.stats[k].n; out[k].ms += g.stats[k].ms; }
      console.error(`game ${i + 1}/${jobs.length}: ${CA.name} ${g.aScore === 1 ? '1-0' : g.aScore === 0 ? '0-1' : '1/2'} (${g.reason}, ${g.plies} plies)`);
    }
    A.quit(); B.quit();
  };
  await Promise.all(Array.from({ length: PAR }, worker));
  const n = out.w + out.d + out.l, score = (out.w + out.d / 2) / n;
  const elo = x => x <= 0 ? -Infinity : x >= 1 ? Infinity : -400 * Math.log10(1 / x - 1);
  const se = Math.sqrt((out.w * (1 - score) ** 2 + out.d * (0.5 - score) ** 2 + out.l * score ** 2) / n) / Math.sqrt(n);
  console.log(JSON.stringify({
    tc: TC, a: CA, b: CB, games: n, W: out.w, D: out.d, L: out.l, score: +score.toFixed(3),
    eloA_minus_B: +elo(score).toFixed(0), ci95: [+elo(score - 1.96 * se).toFixed(0), +elo(score + 1.96 * se).toFixed(0)],
    reasons: out.reasons, flagsLostByA: out.flagsA, flagsLostByB: out.flagsB,
    avgMsPerMove: { A: Math.round(out.A.ms / Math.max(1, out.A.n)), B: Math.round(out.B.ms / Math.max(1, out.B.n)) }
  }));
  process.exit(0);
})();
