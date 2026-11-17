// Engine-vs-engine test of "play for a win": A = plain best move, B = the script's two-stage selection.
// Both use the same Stockfish 19 full engine and the same time per move; colours alternate; each game starts from a
// different opening position. Usage: node selfplay.js <games> <ms> <fight|control>
const { spawn } = require('child_process');
const path = require('path');
const { Chess } = require('chess.js');
const { load } = require('../test/harness.js');
const { T } = load(process.env.SCRIPT || require('path').join(__dirname, '..', 'evilfish.user.js'));

if (process.env.TOL) T.FIGHT.tol = +process.env.TOL;
if (process.env.BAND) T.FIGHT.band = +process.env.BAND;
const GAMES = +process.argv[2] || 24;
const MS = +process.argv[3] || 150;
const MODE = process.argv[4] || 'fight';
const ENGINE = path.join(__dirname, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19-single.js');

class Engine {
  constructor() {
    this.p = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.waiters = [];
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.waiters.slice().forEach(w => w(l)); } });
  }
  send(c) { this.p.stdin.write(c + '\n'); }
  until(t, on) { return new Promise(r => { const w = l => { if (on) on(l); if (t(l)) { this.waiters = this.waiters.filter(x => x !== w); r(l); } }; this.waiters.push(w); }); }
  async init() { this.send('uci'); await this.until(l => l === 'uciok'); this.send('setoption name Hash value 128'); this.send('isready'); await this.until(l => l === 'readyok'); }
  // returns entries {move, pv, scoreRaw, mateScore} sorted by multipv (side-to-move point of view)
  async search(startFEN, moves, ms, multipv) {
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${startFEN}` + (moves.length ? ' moves ' + moves.join(' ') : ''));
    this.send(`go movetime ${ms}`);
    const pv = {};
    const last = await this.until(l => l.startsWith('bestmove'), l => {
      const m = l.match(/^info depth (\d+).* multipv (\d+) score (cp|mate) (-?\d+).* pv (.+)$/);
      if (m && !/(lowerbound|upperbound)/.test(l)) { const moves = m[5].trim().split(' '); pv[+m[2]] = { move: moves[0], pv: moves, scoreRaw: m[3] === 'cp' ? +m[4] : null, mateScore: m[3] === 'mate' ? +m[4] : null }; }
    });
    const list = Object.keys(pv).sort((a, b) => a - b).map(k => pv[k]);
    return { best: last.split(' ')[1], list };
  }
}

const uci = m => m.from + m.to + (m.promotion || '');

async function pickMove(engine, kind, startFEN, moves, fen) {
  if (kind === 'plain') return (await engine.search(startFEN, moves, MS, 1)).best;
  if (kind === 'double') return (await engine.search(startFEN, moves, MS * 2, 1)).best;
  if (kind === 'think') {                                   // longer look only where the position is level
    const a = await engine.search(startFEN, moves, MS, 1);
    if (!a.list.length || !T.fightDrawish(a.list[0])) return a.best;
    return (await engine.search(startFEN, moves, MS, 1)).best;
  }
  const first = await engine.search(startFEN, moves, MS, 1);
  if (!first.list.length || !T.fightDrawish(first.list[0])) return first.best;
  const second = await engine.search(startFEN, moves, Math.max(200, Math.round(MS * 0.8)), 3);
  if (second.list.length < 2) return first.best;
  // make sure the engine's own bestmove leads the list
  const st = { fen, startFEN, moves };
  const chosen = T.pickFighting(st, second.list);
  return chosen[0].move;
}

(async () => {
  const A = new Engine(), B = new Engine();
  await A.init(); await B.init();
  let s = 424242; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const lines = [];
  for (const op of T.OPENINGS) for (const l of op.lines) lines.push(l.split(' '));
  const tally = { win: 0, draw: 0, loss: 0, reasons: {}, plies: 0 };
  for (let g = 0; g < GAMES; g++) {
    // fighting side plays White in even games, Black in odd games; same opening for the colour pair
    const pairIdx = Math.floor(g / 2);
    const line = lines[(pairIdx * 7 + 3) % lines.length];
    const n = 6 + (pairIdx % 5);
    const chess = new Chess();
    const moves = [];
    for (const m of line.slice(0, n)) { try { chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); moves.push(m); } catch (e) { break; } }
    const startFEN = new Chess().fen();
    const fighterWhite = g % 2 === 0;
    A.send('ucinewgame'); B.send('ucinewgame');
    let reason = '';
    while (!chess.isGameOver() && moves.length < 220) {
      const whiteToMove = chess.turn() === 'w';
      const isFighter = whiteToMove === fighterWhite;
      const kind = isFighter ? (MODE === 'fight' ? 'fight' : MODE === 'think' ? 'think' : MODE === 'double' ? 'double' : 'plain') : 'plain';
      const eng = isFighter ? B : A;
      const mv = await pickMove(eng, kind, startFEN, moves, chess.fen());
      let ok = null;
      try { ok = chess.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] }); } catch (e) {}
      if (!ok) { reason = 'illegal ' + mv; break; }
      moves.push(uci(ok));
    }
    let result;
    if (reason) result = 'draw';
    else if (chess.isCheckmate()) { result = (chess.turn() === 'w') === fighterWhite ? 'loss' : 'win'; reason = 'mate'; }
    else {
      result = 'draw';
      reason = chess.isThreefoldRepetition() ? 'repetition' : chess.isInsufficientMaterial() ? 'insufficient' : chess.isStalemate() ? 'stalemate' : chess.isDrawByFiftyMoves() ? '50-move' : moves.length >= 220 ? 'ply cap' : 'draw';
    }
    tally[result]++; tally.reasons[reason] = (tally.reasons[reason] || 0) + 1; tally.plies += moves.length;
    console.log(`game ${g + 1}/${GAMES} fighter=${fighterWhite ? 'white' : 'black'} ${result} (${reason}, ${moves.length} plies)  running W-D-L ${tally.win}-${tally.draw}-${tally.loss}`);
  }
  console.log(JSON.stringify({ mode: MODE, ms: MS, games: GAMES, wins: tally.win, draws: tally.draw, losses: tally.loss, avgPlies: Math.round(tally.plies / GAMES), reasons: tally.reasons }));
  A.p.kill(); B.p.kill();
})();
