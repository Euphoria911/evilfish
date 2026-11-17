// existing tiers against each other: node reftest.js <tierA> <tierB> <games>
const { spawn } = require('child_process');
const path = require('path');
const { Chess } = require('chess.js');
const { load } = require('../test/harness.js');
const { T } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));
const TIERS = [null,
  { mode: 'elo', depth: 12, elo: 1700 }, { mode: 'elo', depth: 12, elo: 1500 }, { mode: 'elo', depth: 12, elo: 1350 },
  { mode: 'skill', depth: 6, skill: 4 }, { mode: 'skill', depth: 4, skill: 1 }, { mode: 'skill', depth: 2, skill: 0 }];
const A_T = +process.argv[2], B_T = +process.argv[3], GAMES = +process.argv[4] || 30;
const ENGINE = path.join(__dirname, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19-single.js');
class Engine {
  constructor() { this.p = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] }); this.buf = ''; this.w = [];
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.w.slice().forEach(f => f(l)); } }); }
  send(c) { this.p.stdin.write(c + '\n'); }
  until(t) { return new Promise(r => { const f = l => { if (t(l)) { this.w = this.w.filter(x => x !== f); r(l); } }; this.w.push(f); }); }
  async init(t) { this.send('uci'); await this.until(l => l === 'uciok'); this.send('setoption name Hash value 64');
    if (t.mode === 'elo') { this.send('setoption name Skill Level value 20'); this.send('setoption name UCI_LimitStrength value true'); this.send(`setoption name UCI_Elo value ${t.elo}`); }
    else { this.send('setoption name UCI_LimitStrength value false'); this.send(`setoption name Skill Level value ${t.skill}`); }
    this.send('isready'); await this.until(l => l === 'readyok'); this.t = t; }
  async best(startFEN, moves) { this.send(`position fen ${startFEN}` + (moves.length ? ' moves ' + moves.join(' ') : '')); this.send(`go depth ${this.t.depth}`); return (await this.until(l => l.startsWith('bestmove'))).split(' ')[1]; }
}
(async () => {
  const A = new Engine(), B = new Engine(); await A.init(TIERS[A_T]); await B.init(TIERS[B_T]);
  const lines = []; for (const op of T.OPENINGS) for (const l of op.lines) lines.push(l.split(' '));
  let w = 0, d = 0, l = 0;
  for (let g = 0; g < GAMES; g++) {
    const line = lines[(Math.floor(g / 2) * 13 + 7) % lines.length]; const n = 4 + (Math.floor(g / 2) % 5);
    const chess = new Chess(); const moves = [];
    for (const m of line.slice(0, n)) { try { chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); moves.push(m); } catch (e) { break; } }
    const aWhite = g % 2 === 0; A.send('ucinewgame'); B.send('ucinewgame');
    while (!chess.isGameOver() && moves.length < 240) {
      const isA = (chess.turn() === 'w') === aWhite;
      const mv = await (isA ? A : B).best(new Chess().fen(), moves);
      let ok = null; try { ok = chess.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] }); } catch (e) {}
      if (!ok) break; moves.push(ok.from + ok.to + (ok.promotion || ''));
    }
    if (chess.isCheckmate()) { if ((chess.turn() === 'w') === aWhite) l++; else w++; } else d++;
  }
  const score = (w + d / 2) / GAMES; const elo = Math.round(-400 * Math.log10(1 / Math.max(0.001, Math.min(0.999, score)) - 1));
  console.log(JSON.stringify({ A: A_T, B: B_T, games: GAMES, aWins: w, draws: d, aLosses: l, aScore: +score.toFixed(3), aMinusB_Elo: elo }));
  A.p.kill(); B.p.kill();
})();
