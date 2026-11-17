// Fuzz the new v4 helpers (stepFEN, inferMove, historyConsistent, squareAttacked, isValidFEN) against chess.js.
const { Chess } = require('chess.js');
const { load } = require('./harness.js');
const { T } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));

let s = 987654321;
const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const GAMES = +process.argv[2] || 60;

const stats = { positions: 0, stepBad: 0, inferBad: 0, histBad: 0, invalidFen: 0, attackBad: 0, wrongTurnAccepted: 0, wrongTurnTotal: 0, promo: 0, ep: 0, castle: 0 };
const samples = { step: [], infer: [], hist: [], invalid: [], attack: [] };
const uciOf = m => m.from + m.to + (m.promotion || '');

for (let game = 0; game < GAMES; game++) {
  const g = new Chess();
  const moves = [];
  const start = g.fen();
  for (let ply = 0; ply < 200 && !g.isGameOver(); ply++) {
    const fen = g.fen();
    stats.positions++;
    if (!T.isValidFEN(fen)) { stats.invalidFen++; if (samples.invalid.length < 4) samples.invalid.push(fen); }

    // squareAttacked vs chess.js for both kings
    for (const color of ['w', 'b']) {
      const sq = g.board().flat().find(p => p && p.type === 'k' && p.color === color)?.square;
      const by = color === 'w' ? 'b' : 'w';
      const mine = T.squareAttacked(T.boardFromPlacement(fen.split(' ')[0]), sq, by);
      if (mine !== g.isAttacked(sq, by)) { stats.attackBad++; if (samples.attack.length < 3) samples.attack.push(`${fen} ${sq} by ${by}`); }
    }
    // wrong-turn rejection: flip side to move when the opponent is in check -> must be rejected
    if (g.inCheck()) {
      stats.wrongTurnTotal++;
      const parts = fen.split(' ');
      parts[1] = parts[1] === 'w' ? 'b' : 'w'; parts[3] = '-';
      if (T.isValidFEN(parts.join(' '))) stats.wrongTurnAccepted++;
    }

    const legal = g.moves({ verbose: true });
    const special = legal.filter(x => /[kqep]/.test(x.flags.replace(/[nb]/g, "")) || x.promotion); const m = special.length && rand() < 0.85 ? special[Math.floor(rand() * special.length)] : legal[Math.floor(rand() * legal.length)];
    const uci = uciOf(m);
    const stepped = T.stepFEN(fen, uci);
    g.move(m);
    moves.push(uci);
    const truth = g.fen();
    if (m.promotion) stats.promo++;
    if (m.flags.includes('e')) stats.ep++;
    if (m.flags.includes('k') || m.flags.includes('q')) stats.castle++;
    const a = stepped.split(' '), b = truth.split(' ');
    // placement, side, castling, halfmove, fullmove must match; ep: ours is set after any double push, chess.js only when capturable
    const epOk = b[3] === '-' ? true : a[3] === b[3];
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[4] !== b[4] || a[5] !== b[5] || !epOk) {
      stats.stepBad++; if (samples.step.length < 5) samples.step.push(`${fen} ${uci}\n   mine ${stepped}\n   true ${truth}`);
    }
    const inf = T.inferMove(fen, truth.split(' ')[0]);
    if (inf !== uci) { stats.inferBad++; if (samples.infer.length < 5) samples.infer.push(`${fen} expected ${uci} got ${inf}`); }
  }
  if (!T.historyConsistent(start, moves, g.fen())) { stats.histBad++; if (samples.hist.length < 3) samples.hist.push(moves.join(' ').slice(0, 120)); }
}
console.log(stats);
for (const k of Object.keys(samples)) if (samples[k].length) console.log(k, samples[k]);
