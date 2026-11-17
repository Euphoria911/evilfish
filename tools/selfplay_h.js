// Calibrates the human-like mover against the existing strength tiers.
// usage: node selfplay_h.js <tierIdx 1..6> <games> [label]   env: TSCALE (x T), PB (slip chance), D (depth), K, NOTICE
// The REF configs below are the engine settings of the ladder before v4.2.1 (the human table was calibrated against them).
const { spawn } = require('child_process');
const path = require('path');
const { Chess } = require('chess.js');
const { load } = require('../test/harness.js');
const { T } = load(process.env.SCRIPT || require('path').join(__dirname, '..', 'evilfish.user.js'));

const TIER = +process.argv[2] || 2;
const GAMES = +process.argv[3] || 40;
const LABEL = process.argv[4] || '';
const TIERS = [
  null,
  { mode: 'elo', depth: 12, elo: 1700 }, { mode: 'elo', depth: 12, elo: 1500 }, { mode: 'elo', depth: 12, elo: 1350 },
  { mode: 'skill', depth: 6, skill: 4 }, { mode: 'skill', depth: 4, skill: 1 }, { mode: 'skill', depth: 2, skill: 0 }
];
const ref = TIERS[+process.env.REF || TIER];
const P = Object.assign({}, T.HUMAN[TIER]);
if (process.env.P) Object.assign(P, JSON.parse(process.env.P));
if (process.env.TSCALE) P.T = Math.round(P.T * +process.env.TSCALE);
if (process.env.TABS) P.T = +process.env.TABS;
if (process.env.PB) P.pb = +process.env.PB;
if (process.env.D) P.d = +process.env.D;
if (process.env.K) P.k = +process.env.K;
if (process.env.NOTICE) P.notice = +process.env.NOTICE;
const ENGINE = path.join(__dirname, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19-single.js');

class Engine {
  constructor() {
    this.p = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.waiters = [];
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.waiters.slice().forEach(w => w(l)); } });
  }
  send(c) { this.p.stdin.write(c + '\n'); }
  until(t, on) { return new Promise(r => { const w = l => { if (on) on(l); if (t(l)) { this.waiters = this.waiters.filter(x => x !== w); r(l); } }; this.waiters.push(w); }); }
  async init() { this.send('uci'); await this.until(l => l === 'uciok'); this.send('setoption name Hash value 64'); this.send('isready'); await this.until(l => l === 'readyok'); }
  async search(startFEN, moves, depth, multipv) {
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${startFEN}` + (moves.length ? ' moves ' + moves.join(' ') : ''));
    this.send(`go depth ${depth}`);
    const pv = {};
    const last = await this.until(l => l.startsWith('bestmove'), l => {
      const m = l.match(/^info depth (\d+).* multipv (\d+) score (cp|mate) (-?\d+).* pv (.+)$/);
      if (m && !/(lowerbound|upperbound)/.test(l)) { const mv = m[5].trim().split(' '); pv[+m[2]] = { move: mv[0], pv: mv, scoreRaw: m[3] === 'cp' ? +m[4] : null, mateScore: m[3] === 'mate' ? +m[4] : null }; }
    });
    return { best: last.split(' ')[1], list: Object.keys(pv).sort((a, b) => a - b).map(k => pv[k]) };
  }
}

const uci = m => m.from + m.to + (m.promotion || '');

(async () => {
  const H = new Engine(), R = new Engine();
  await H.init(); await R.init();
  H.send('setoption name UCI_LimitStrength value false'); H.send('setoption name Skill Level value 20');
  if (ref.mode === 'elo') { R.send('setoption name Skill Level value 20'); R.send('setoption name UCI_LimitStrength value true'); R.send(`setoption name UCI_Elo value ${ref.elo}`); }
  else { R.send('setoption name UCI_LimitStrength value false'); R.send(`setoption name Skill Level value ${ref.skill}`); }
  const OFF = +process.env.OFF || 0; let s = 777 + TIER + OFF * 1000; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const lines = [];
  for (const op of T.OPENINGS) for (const l of op.lines) lines.push(l.split(' '));
  const tally = { win: 0, draw: 0, loss: 0, plies: 0, hMoves: 0, hHang: 0, rMoves: 0, rHang: 0 };
  for (let g = 0; g < GAMES; g++) {
    const line = lines[(Math.floor(g / 2) * 11 + 5 + OFF * 37) % lines.length];
    const n = 4 + (Math.floor(g / 2) % 5);
    const chess = new Chess(); const moves = [];
    for (const m of line.slice(0, n)) { try { chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); moves.push(m); } catch (e) { break; } }
    const startFEN = new Chess().fen();
    const humanWhite = g % 2 === 0;
    H.send('ucinewgame'); R.send('ucinewgame');
    while (!chess.isGameOver() && moves.length < 240) {
      const white = chess.turn() === 'w';
      const isHuman = white === humanWhite;
      const fen = chess.fen();
      let mv;
      if (isHuman) {
        const r = await H.search(startFEN, moves, P.d, P.k);
        const picked = T.humanPick({ fen, startFEN, moves }, r.list, P, rnd);
        mv = picked[0].move;
      } else {
        mv = (await R.search(startFEN, moves, ref.depth, 1)).best;
      }
      const before = T.boardFromPlacement(fen.split(' ')[0]);
      const after = Object.assign({}, before); T.applyMove(after, mv);
      const loss = T.hangingLoss(after, chess.turn());
      if (isHuman) { tally.hMoves++; if (loss >= 3) tally.hHang++; } else { tally.rMoves++; if (loss >= 3) tally.rHang++; }
      let ok = null;
      try { ok = chess.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] }); } catch (e) {}
      if (!ok) break;
      moves.push(uci(ok));
    }
    let result = 'draw';
    if (chess.isCheckmate()) result = (chess.turn() === 'w') === humanWhite ? 'loss' : 'win';
    tally[result]++; tally.plies += moves.length;
  }
  const score = (tally.win + 0.5 * tally.draw) / GAMES;
  // rough Elo difference from the score
  const elo = score <= 0 ? -800 : score >= 1 ? 800 : Math.round(-400 * Math.log10(1 / score - 1));
  console.log(JSON.stringify({ tier: TIER, label: LABEL, params: P, games: GAMES, wins: tally.win, draws: tally.draw, losses: tally.loss, score: +score.toFixed(3), eloDiff: elo,
    avgPlies: Math.round(tally.plies / GAMES), humanHangRate: +(100 * tally.hHang / Math.max(1, tally.hMoves)).toFixed(2) + '%', refHangRate: +(100 * tally.rHang / Math.max(1, tally.rMoves)).toFixed(2) + '%' }));
  H.p.kill(); R.p.kill();
})();
