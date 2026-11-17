// hangingLoss / attackersOf sanity against chess.js: whenever hangingLoss says a piece is en prise,
// the opponent should have a legal capture on that square in nearly every case (pins are the exception).
const { Chess } = require('chess.js');
const { load } = require('./harness.js');
const { T } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));
let s = 31337; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
let checked = 0, flagged = 0, confirmed = 0, missedHang = 0, trulyHanging = 0, attackerMismatch = 0, attackerChecks = 0;
for (let game = 0; game < 120; game++) {
  const g = new Chess();
  for (let ply = 0; ply < 120 && !g.isGameOver(); ply++) {
    const legal = g.moves({ verbose: true });
    const m = legal[Math.floor(rnd() * legal.length)];
    const mover = g.turn();
    g.move(m);
    const pieces = T.boardFromPlacement(g.fen().split(' ')[0]);
    const loss = T.hangingLoss(pieces, mover);
    checked++;
    // truth: the opponent (now to move) can legally capture a piece of the mover that is undefended or worth more than the capturer
    const caps = g.moves({ verbose: true }).filter(x => x.captured && x.captured !== 'k');
    let truth = false;
    for (const c of caps) {
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9 }[c.captured];
      const capVal = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }[c.piece];
      const defended = g.isAttacked(c.to, mover);
      if (val >= 3 && (!defended || capVal < val)) truth = true;
    }
    if (loss >= 3) { flagged++; if (caps.some(c => { const v = { p: 1, n: 3, b: 3, r: 5, q: 9 }[c.captured]; return v >= 3; })) confirmed++; }
    if (truth) { trulyHanging++; if (loss < 3) missedHang++; }
    // attackersOf vs chess.js isAttacked on a sample of squares
    for (const sq of ['d4', 'e5', 'f3', 'c6']) {
      for (const by of ['w', 'b']) {
        attackerChecks++;
        if ((T.attackersOf(pieces, sq, by).length > 0) !== g.isAttacked(sq, by)) attackerMismatch++;
      }
    }
  }
}
console.log({ positions: checked, flaggedHanging: flagged, flaggedAndOpponentCanCapture: confirmed,
  confirmedRate: (100 * confirmed / flagged).toFixed(1) + '%', trulyHanging, missedByModel: missedHang,
  recall: (100 * (trulyHanging - missedHang) / trulyHanging).toFixed(1) + '%', attackerChecks, attackerMismatch });
