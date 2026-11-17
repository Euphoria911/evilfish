// opening book: every line legal + script index keys match chess.js (v4 build)
const { Chess } = require('chess.js');
const { load } = require('./harness.js');
const { T } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));
let lines = 0, illegal = 0, missing = 0, checked = 0;
for (const op of T.OPENINGS) {
  if (!op.side) continue;
  const idx = T.buildOpeningIndex(op);
  for (const line of op.lines) {
    lines++;
    const g = new Chess();
    const moves = line.split(' ');
    for (let ply = 0; ply < moves.length; ply++) {
      const side = ply % 2 ? 'b' : 'w';
      if (side === op.side) { checked++; if (!idx.has(g.fen().split(' ').slice(0, 3).join(' '))) missing++; }
      let ok = null; try { ok = g.move({ from: moves[ply].slice(0, 2), to: moves[ply].slice(2, 4), promotion: moves[ply][4] }); } catch (e) {}
      if (!ok) { illegal++; break; }
    }
  }
}
console.log({ lines, illegal, bookPositionsChecked: checked, missingFromIndex: missing });
