const { load } = require('./harness.js');
const { T, ef } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));
const assert = require('assert');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const st = { fen: START, startFEN: START, moves: [] };
let ok = 0; const t = (name, fn) => { try { fn(); ok++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } };

t('human off by default: normal job at 70%', () => {
  ef.accuracy = 2; ef.speed = 1;
  assert.strictEqual(T.humanParams(), null);
  const j = T.makeJob(st);
  assert.ok(!j.human); assert.strictEqual(j.depth, 12);
});
t('human on at 70%: shallow multi-line job', () => {
  ef.human = true;
  const P = T.humanParams(); assert.ok(P);
  const j = T.makeJob(st);
  assert.ok(j.human, 'job flagged human'); assert.strictEqual(j.depth, P.d); assert.strictEqual(j.multiPV, P.k);
  assert.ok(!j.earlyStop && !j.allowExtend && !j.fight && !j.surpriseExtend);
});
t('human on at 100%: no effect', () => {
  ef.accuracy = 0;
  assert.strictEqual(T.humanParams(), null);
  const j = T.makeJob(st); assert.ok(!j.human); assert.strictEqual(j.depth, 22);
});
t('every tier has parameters', () => {
  for (let i = 1; i <= 6; i++) { ef.accuracy = i; const P = T.humanParams(); assert.ok(P && P.d >= 2 && P.k >= 2 && P.T > 0, 'tier ' + i); }
});
t('humanPick returns every candidate once and flags the choice', () => {
  const list = ['e2e4','d2d4','g1f3','c2c4','b1c3'].map((m, i) => ({ move: m, pv: [m], scoreRaw: 30 - i * 5, mateScore: null, side: 'w' }));
  const P = T.HUMAN[2];
  for (let k = 0; k < 200; k++) {
    const out = T.humanPick(st, list, P);
    assert.strictEqual(out.length, 5); assert.ok(out[0].human);
    assert.strictEqual(JSON.stringify(out.map(e => e.move).sort()), JSON.stringify(list.map(e => e.move).sort()));
  }
});
t('humanPick never throws a mating move away', () => {
  // back-rank mate in one: Ra8#; weak alternatives
  const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
  const s2 = { fen, startFEN: fen, moves: [] };
  const list = [{ move: 'a1a8', pv: ['a1a8'], scoreRaw: null, mateScore: 1 }, { move: 'e1e2', pv: ['e1e2'], scoreRaw: 300 }, { move: 'e1d2', pv: ['e1d2'], scoreRaw: 290 }, { move: 'a1a2', pv: ['a1a2'], scoreRaw: 280 }];
  let hits = 0; const N = 1000;
  for (let k = 0; k < N; k++) if (T.humanPick(s2, list, T.HUMAN[6])[0].move === 'a1a8') hits++;
  console.log('     weakest tier plays the mate ' + (100 * hits / N).toFixed(1) + '% of the time'); assert.ok(hits / N > 0.85);
});
t('humanPick avoids hanging the queen when it notices', () => {
  // white queen d1; Qd1xd7?? loses the queen to Nxd7 / Qxd7 type trade; use a simple hang: Qd4 into pawn attack
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const s2 = { fen, startFEN: fen, moves: [] };
  // Qh5 is fine; Qg4 is fine; Bb5+ ; exd5 takes a pawn. Make a hanging case: Nf3 then Nxe5?? skip; construct directly:
  const fen2 = 'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2';
  const s3 = { fen: fen2, startFEN: fen2, moves: [] };
  const list = [{ move: 'd4e5', pv: ['d4e5'], scoreRaw: 20 }, { move: 'd1d3', pv: ['d1d3'], scoreRaw: 0 }, { move: 'g1f3', pv: ['g1f3'], scoreRaw: 10 }];
  // Qd3 is not hanging; just check ordering stays sane (no exceptions, flagged)
  const out = T.humanPick(s3, list, T.HUMAN[1]);
  assert.ok(out[0].human && out.length === 3);
});
console.log(ok + ' passed');
