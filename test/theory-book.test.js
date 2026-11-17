// theory book checks on the real build: every entry round-trips, is legal, and covers repertoire positions
const { Chess } = require('chess.js');
const { load } = require('./harness.js');
const { T } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));
const entries = JSON.parse(require('fs').readFileSync(process.env.THEORY || require('path').join(__dirname, '..', 'data', 'theory_book.json'), 'utf8'));
let ok = 0, bad = 0, illegal = 0;
const bySide = { w: 0, b: 0 };
for (const [key, mv] of entries) {
  const fen = key + ' - 0 1';
  if (T.theoryMoveFor(fen) === mv) ok++; else bad++;
  const g = new Chess(fen);
  if (!g.moves({ verbose: true }).some(m => m.from + m.to + (m.promotion || '') === mv)) illegal++;
  bySide[key.split(' ')[1]]++;
}
console.log({ entries: entries.length, packedMapSize: T.theory.size, roundTrip: ok, mismatches: bad, illegal, whiteToMove: bySide.w, blackToMove: bySide.b });
// repertoire coverage: share of my-turn positions in each opening's lines that the theory book also answers
let tot = 0, cov = 0;
const per = [];
for (const op of T.OPENINGS) {
  if (!op.side) continue;
  let t = 0, c = 0;
  for (const line of op.lines) {
    const g = new Chess(); const mv = line.split(' ');
    for (let ply = 0; ply < mv.length; ply++) {
      if ((ply % 2 ? 'b' : 'w') === op.side) { t++; if (T.theoryMoveFor(g.fen())) c++; }
      g.move({ from: mv[ply].slice(0, 2), to: mv[ply].slice(2, 4), promotion: mv[ply][4] });
    }
  }
  tot += t; cov += c; per.push(`${op.name}: ${c}/${t}`);
}
console.log(`repertoire positions also covered by theory: ${cov}/${tot} (${(100 * cov / tot).toFixed(0)}%)`);
console.log(per.slice(0, 6).join(' | '));
// does the book agree with the repertoire where both speak? (informational)
let agree = 0, both = 0;
for (const op of T.OPENINGS) {
  if (!op.side) continue;
  const idx = T.buildOpeningIndex(op);
  for (const [k, v] of idx) { if (typeof k !== 'string') continue; const tm = T.theory.get(T.hashKey(k)); if (tm) { both++; if (tm === v.move) agree++; } }
}
console.log(`where both repertoire and theory have an answer: ${agree}/${both} identical`);
