// 4.3.0 behaviour: two-ply board inference, pacing model, serialized cloud queue, premove gating, human context.
const { Chess } = require('chess.js');
const path = require('path');
const assert = require('assert');
const { load } = require('./harness.js');
const file = path.join(__dirname, '..', 'evilfish.user.js');

let bad = 0;
const t = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + (e.message || e)); } };
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };

// ── two-ply inference against chess.js ──
{
  const { T } = load(file);
  const r = rng(7);
  const placementOf = fen => fen.split(' ')[0];
  t('inferMoves explains one and two plies of random games (castling, en passant, promotion included)', () => {
    let checked = 0, two = 0, wrong = 0;
    for (let g = 0; g < 50; g++) {
      const c = new Chess();
      const fens = [c.fen()];
      for (let i = 0; i < 120 && !c.isGameOver(); i++) { const m = c.moves({ verbose: true }); c.move(m[Math.floor(r() * m.length)]); fens.push(c.fen()); }
      for (let i = 0; i + 2 < fens.length; i += 3) {
        for (const span of [1, 2]) {
          const from = fens[i], to = fens[i + span];
          const mvs = T.inferMoves(from, placementOf(to));
          checked++;
          if (!mvs) { wrong++; continue; }
          if (span === 2) two++;
          // the returned moves must be legal in order and land on the target placement
          const v = new Chess(from);
          for (const m of mvs) v.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
          if (placementOf(v.fen()) !== placementOf(to)) wrong++;
        }
      }
    }
    assert.ok(checked > 600, 'enough samples: ' + checked);
    assert.strictEqual(wrong, 0, `${wrong} of ${checked} wrong`);
    assert.ok(two > 300, 'two-ply cases covered: ' + two);
  });
  t('inferMoves refuses a board that is three plies away', () => {
    const c = new Chess(); for (const m of ['e2e4', 'e7e5', 'g1f3']) c.move({ from: m.slice(0, 2), to: m.slice(2, 4) });
    assert.strictEqual(T.inferMoves('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', placementOf(c.fen())), null);
  });
}

// ── pacing ──
{
  const { T, ef } = load(file);
  const st = n => ({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', moves: new Array(n).fill('e2e4'), startFEN: '' });
  const sample = (kind, clockMs, n = 400, scale = 1, plies = 30) => {
    const r = rng(3); const xs = [];
    for (let i = 0; i < n; i++) xs.push(T.paceTarget(kind, st(plies), [], { rnd: r, clockMs, scale }));
    xs.sort((a, b) => a - b); return { med: xs[n >> 1], p90: xs[Math.floor(n * 0.9)], min: xs[0], max: xs[n - 1] };
  };
  t('pacing off plays at once', () => assert.strictEqual(T.paceTarget('quiet', st(30), [], { scale: 0, clockMs: 100000 }), 0));
  t('a quiet move on a 3-minute clock takes seconds, not milliseconds', () => { const q = sample('quiet', 150000); assert.ok(q.med > 1500 && q.med < 6500, JSON.stringify(q)); });
  t('book < recapture < quiet, forced is quickest', () => {
    const m = k => sample(k, 150000).med;
    assert.ok(m('forced') < m('recapture') && m('recapture') < m('quiet') && m('book') < m('quiet'), [m('forced'), m('book'), m('recapture'), m('quiet')].join(' '));
  });
  t('think time follows the clock', () => assert.ok(sample('quiet', 600000).med > sample('quiet', 60000).med * 1.5));
  t('with seconds left it never stalls', () => { const q = sample('quiet', 6000); assert.ok(q.max <= 600, JSON.stringify(q)); });
  t('never longer than a fifth of the clock or 20 s', () => { const q = sample('quiet', 900000, 800); assert.ok(q.max <= 20000, JSON.stringify(q)); });
  t('has a long tail but is never absurdly short', () => { const q = sample('quiet', 300000, 2000); assert.ok(q.p90 > q.med * 1.25 && q.min >= 260, JSON.stringify(q)); });
  t('on a short clock pacing is capped to 3 % of it and vanishes in a scramble', () => {
    const q = sample('quiet', 20000, 500); assert.ok(q.max <= 20000 * 0.03 + 40, JSON.stringify(q));
    const z = sample('quiet', 2500, 100); assert.strictEqual(z.max, 0, JSON.stringify(z));
  });
  t('quick mode is faster than natural', () => assert.ok(sample('quiet', 150000, 400, 0.55).med < sample('quiet', 150000).med * 0.7));
  t('moveKind: recapture, capture, check, quiet, book, forced', () => {
    const open = { fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', moves: ['e2e4', 'd7d5'] };
    assert.strictEqual(T.moveKind(open, { move: 'e4d5' }), 'capture', 'taking the piece that just moved is a decision, not a reflex');
    assert.strictEqual(T.moveKind(open, { move: 'g1f3' }), 'quiet');
    assert.strictEqual(T.moveKind(open, { move: 'a2a3', label: 'book 3/9' }), 'book');
    assert.strictEqual(T.moveKind(open, { move: 'a2a3', label: 'theory' }), 'book');
    assert.strictEqual(T.moveKind(open, { move: 'a2a3', label: 'forced' }), 'forced');
    const trade = { fen: 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3', moves: ['b1c3', 'g8f6', 'f6d5', 'd8d5'] };
    assert.strictEqual(T.moveKind(trade, { move: 'c3d5' }), 'recapture', 'the last two moves traded on d5');
    assert.strictEqual(T.moveKind({ fen: 'rnbqkbnr/pppp1ppp/8/8/8/4p3/PPPPQPPP/RNB1KBNR w KQkq - 0 4', moves: [] }, { move: 'e2e3' }), 'capture');
  });
}

// ── cloud queue ──
{
  let inflight = 0, maxInflight = 0; const sent = []; const waiting = [];
  const gm = { GM_xmlhttpRequest: o => { inflight++; maxInflight = Math.max(maxInflight, inflight); sent.push(decodeURIComponent(o.url.split('fen=')[1])); waiting.push(o); }, GM_getValue: () => undefined, GM_setValue() {} };
  const { T } = load(file, gm);
  const finish = (i, status = 404) => { const o = waiting[i]; inflight--; o.onload({ status, responseText: '{}' }); };
  t('cloud: one request at a time, the awaited position goes first, stale warm-ups are dropped', () => {
    const got = {};
    T.lookupCloud('A', undefined);                    // warm-up, goes out at once (nothing in flight)
    T.lookupCloud('B', undefined);                    // warm-up, queued
    T.lookupCloud('C', undefined);                    // warm-up, queued
    T.lookupCloud('D', v => { got.D = v; });          // awaited: jumps the queue
    assert.deepStrictEqual(sent, ['A']);
    T.cloud.gen++;                                    // the opponent moved: B and C are stale, D (awaited) is promoted below
    T.lookupCloud('D', v => { got.D2 = v; });
    finish(0);                                        // A answered -> pump
    assert.deepStrictEqual(sent, ['A', 'D'], 'D next, B and C dropped');
    finish(1);
    assert.strictEqual(maxInflight, 1);
    assert.strictEqual(got.D, null); assert.strictEqual(got.D2, null);
    assert.strictEqual(T.cloud.pending.size, 0);
  });
  t('cloud: a 429 blocks the tier and never leaves a pending entry behind', () => {
    T.lookupCloud('E', v => {});
    finish(sent.length - 1, 429);
    assert.ok(T.cloud.blockedUntil > Date.now() + 30000);
    assert.strictEqual(T.cloud.pending.size, 0);
  });
}

// ── premoves need auto move ──
{
  const { T, ef } = load(file);
  const fen0 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
  const st = { fen: fen0, startFEN: fen0, moves: [], atEnd: true, over: false, mode: 'playing', playingAs: 'w', variant: 'chess', source: 'api' };
  const place = fen0.split(' ')[0];
  t('a queued premove is not played while AUTO is off', () => {
    ef.pending.length = 0; ef.pending.push({ kind: 'recapture', move: 'g1f3', expect: place, fen: '', oppMove: 'e7e5' });
    ef.autoMove = false;
    assert.strictEqual(T.playPendingPreMove(st), false);
    assert.strictEqual(ef.lastAutoMoveKey, '');
  });
  t('with AUTO on it is claimed (and paced) instead', () => {
    ef.pending.length = 0; ef.pending.push({ kind: 'recapture', move: 'g1f3', expect: place, fen: '', oppMove: 'e7e5' });
    ef.autoMove = true;
    ef.speed = 3;
    assert.strictEqual(T.playPendingPreMove(st), true);
    assert.strictEqual(ef.lastAutoMoveKey, fen0 + '|g1f3');
  });
}

// ── clock: budget, API clocks, increment ──
{
  const mkGame = (me, mine, theirs, pgn, base = 60000) => ({
    getFEN: () => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', getPlayingAs: () => me,
    clocks: { 1: { get: () => ({ currentTime: me === 1 ? mine : theirs, resetTime: base, state: 'Going' }) }, 2: { get: () => ({ currentTime: me === 2 ? mine : theirs, resetTime: base, state: 'Stopped' }) } },
    getPGN: () => pgn || '', getMode: () => ({ name: 'playing' }), isGameOver: () => false
  });
  const withGame = g => load(file, { board: { game: g, getBoundingClientRect: () => ({ width: 800, top: 0, left: 0 }), classList: { contains: () => false }, hasAttribute: () => false, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null, appendChild() {}, style: {} } });
  const startSt = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', startFEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], atEnd: true };
  t('moveBudget: no clock 800 ms; never above 12 % of the clock; at least 30 ms; falls with the clock', () => {
    const { T } = load(file);
    assert.strictEqual(T.moveBudget(null), 800);
    let prev = Infinity;
    for (const left of [600000, 300000, 180000, 60000, 30000, 15000, 8000, 4000, 2000, 800]) {
      const b = T.moveBudget(left, 0, 20, 0);
      assert.ok(b >= 30 && b <= Math.max(30, left * 0.12), `${left}: ${b}`);
      assert.ok(b <= prev, `${left}: ${b} <= ${prev}`);
      prev = b;
    }
    assert.ok(T.moveBudget(60000, 2000, 20, 0) > T.moveBudget(60000, 0, 20, 0) + 1000, 'increment adds time');
  });
  t('moveBudget: a 28-move scramble from 8.7 s survives (the live loss at 1+0)', () => {
    const { T } = load(file);
    let clock = 8700, moves = 0;
    while (clock > 0 && moves < 80) { clock -= T.moveBudget(clock, 0, 60 + 2 * moves, 25) + 60 /* search start, move, page */; moves++; }
    assert.ok(moves >= 28, 'moves made before the flag: ' + moves);
  });
  t('API clock is read exactly; the job obeys it at every speed', () => {
    const { T, ef } = withGame(mkGame(1, 8700, 41000));
    assert.strictEqual(T.readMyClockMs(), 8700);
    assert.strictEqual(T.readOppClockMs(), 41000);
    ef.accuracy = 0;
    ef.speed = 3; const auto = T.makeJob(startSt); assert.ok(auto.movetime > 0 && auto.movetime <= 260, 'auto ' + auto.movetime);
    ef.speed = 1; const bal = T.makeJob(startSt); assert.ok(bal.movetime <= 260, 'balanced capped by the clock ' + bal.movetime);
    ef.speed = 2; const deep = T.makeJob(startSt); assert.ok(deep.movetime > 0 && deep.movetime < 1000, 'deep gets a time limit when there is a clock ' + deep.movetime);
    assert.ok(!auto.allowExtend && !auto.fight && !auto.surpriseExtend, 'no extensions or focus passes on a short clock');
    ef.speed = 3;
  });
  t('with plenty of clock the job keeps its extensions', () => {
    const { T, ef } = withGame(mkGame(1, 170000, 170000, '', 180000));
    ef.accuracy = 0; ef.speed = 3;
    const j = T.makeJob(startSt);
    assert.ok(j.movetime > 3000 && j.movetime <= 8000, 'movetime ' + j.movetime);
    assert.ok(j.allowExtend && j.fight && j.surpriseExtend);
  });
  t('increment is learned from the PGN clock comments (3+2)', () => {
    const pgn = '[TimeControl "180+2"]\n\n1. e4 {[%clk 0:02:57.0][%timestamp 50]} 1... c5 {[%clk 0:03:01.0][%timestamp 10]} 2. Nf3 {[%clk 0:02:56.0][%timestamp 30]} 2... d6 {[%clk 0:03:02.0][%timestamp 5]} 3. d4 {[%clk 0:02:54.5][%timestamp 35]}';
    const { T, ef } = withGame(mkGame(1, 170000, 170000, pgn, 180000));
    T.learnIncrement();
    assert.strictEqual(ef.inc, 2000);
    const wrapped = '1. e4 {[%clk\n0:03:00.8][%timestamp 12]} 1... c5 {[%clk 0:03:00.6][%timestamp\n14]} 2. Nf3 {[%clk 0:03:01.9][%timestamp 9]} 2... Nc6 {[%clk\n0:03:00.8][%timestamp 18]} 3. d4 {[%clk 0:03:03][%timestamp 9]} 3... cxd4 {[%clk 0:03:02][%timestamp 8]} 4. Nxd4 {[%clk\n0:03:03.1][%timestamp 19]}';
    const { T: T3, ef: ef3 } = withGame(mkGame(1, 183000, 183000, wrapped, 180000));
    T3.learnIncrement();
    assert.strictEqual(ef3.inc, 2000, 'line-wrapped comments (as chess.com writes them) still parse');
    const { T: T2, ef: ef2 } = withGame(mkGame(1, 50000, 50000, '1. e4 {[%clk 0:00:55.0][%timestamp 50]} 1... c5 {[%clk 0:00:59.0][%timestamp 10]} 2. Nf3 {[%clk 0:00:51.0][%timestamp 40]}', 60000));
    T2.learnIncrement();
    assert.strictEqual(ef2.inc, 0, 'no increment at 1+0');
  });
}

// ── new-game prewarm ──
{
  const { T } = load(file);
  const mk = over => { const sent = []; return Object.assign({ worker: { postMessage: c => sent.push(c) }, ready: true, dead: false, state: 'idle', job: null, next: null, newGame: true, sent }, over); };
  t('a new game warms an idle engine up front, once', () => {
    const E = mk();
    assert.strictEqual(T.prewarmNewGame(E), true);
    assert.deepStrictEqual(E.sent, ['ucinewgame']);
    assert.strictEqual(E.newGame, false, 'the first search must not send it again');
  });
  t('a busy, starting or dead engine is left alone (runNext sends it later)', () => {
    for (const over of [{ state: 'searching' }, { ready: false }, { dead: true }, { job: {} }, { next: {} }]) {
      const E = mk(over);
      assert.strictEqual(T.prewarmNewGame(E), false);
      assert.deepStrictEqual(E.sent, []); assert.strictEqual(E.newGame, true);
    }
  });
}

// ── engine output parsing ──
{
  const { T } = load(file);
  const E = () => ({ pv: {}, hist: [] });
  t('parseInfo: a normal line, a bound line, and the empty-pv line that used to throw', () => {
    const e = E();
    assert.strictEqual(T.parseInfo(e, 'info depth 18 seldepth 26 multipv 1 score cp 37 nodes 112909 nps 535113 hashfull 33 time 211 pv e2e4 e7e5 g1f3'), 18);
    assert.strictEqual(e.pv[1].move, 'e2e4');
    assert.strictEqual(T.parseInfo(e, 'info depth 19 multipv 1 score cp 30 lowerbound nodes 1 pv e2e4'), null, 'bound lines are ignored');
    assert.strictEqual(T.parseInfo(e, 'info depth 1 seldepth 1 multipv 1 score cp 0 nodes 1 nps 1 time 0 pv '), null);
    assert.strictEqual(T.parseInfo(e, 'info depth 1 multipv 1 score mate 0 pv'), null);
    assert.strictEqual(e.pv[1].move, 'e2e4', 'the last good line is kept');
  });
}

// ── the top list after a search that was cut in the middle of a depth ──
{
  const { T } = load(file);
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const fresh = () => ({ pv: {}, hist: [], last: {} });
  const feed = (E, lines) => lines.forEach(l => T.parseInfo(E, l));
  const L = (d, m, cp, pv, bound = '') => `info depth ${d} seldepth ${d + 10} multipv ${m} score cp ${cp}${bound} wdl 40 950 10 nodes 1 pv ${pv}`;
  const moves = list => list.map(e => e.move);
  // taken from real native-engine runs (threads 2, movetime 700, MultiPV 3)
  t('final snapshot, slot 1 ends on a bound line: the engine\'s move first, with its score, no duplicates', () => {
    const E = fresh();
    feed(E, [L(21, 1, 23, 'd2d4 g8f6'), L(21, 2, 19, 'e2e4 e7e5'), L(21, 3, 19, 'g1f3 d7d5'), L(22, 1, 21, 'g1f3 d7d5', ' upperbound'), L(22, 2, 20, 'd2d4 g8f6'), L(22, 3, 19, 'e2e4 e7e5')]);
    const list = T.buildList(E, { fen: start, multiPV: 3 }, 'bestmove g1f3 ponder d7d5');
    assert.deepStrictEqual(moves(list), ['g1f3', 'd2d4', 'e2e4']);
    assert.ok(list.every(e => e.depth > 0 && Number.isInteger(e.scoreRaw)), JSON.stringify(list.map(e => [e.move, e.depth, e.scoreRaw])));
    assert.strictEqual(list[0].scoreRaw, 21);
  });
  t('final snapshot with slots at different depths (slot 1 at 22, slots 2 and 3 re-printed at 21)', () => {
    const E = fresh();
    feed(E, [L(21, 1, 26, 'g1f3 d7d5'), L(21, 2, 26, 'd2d4 g8f6'), L(21, 3, 26, 'e2e4 e7e5'), L(22, 1, 34, 'e2e4 e7e5'), L(21, 2, 26, 'g1f3 d7d5'), L(21, 3, 26, 'd2d4 g8f6')]);
    const list = T.buildList(E, { fen: start, multiPV: 3 }, 'bestmove e2e4 ponder e7e5');
    assert.deepStrictEqual(moves(list), ['e2e4', 'g1f3', 'd2d4']);
    assert.deepStrictEqual(list.map(e => e.depth), [22, 21, 21]);
  });
  t('a normal complete search is used as it stands', () => {
    const E = fresh();
    feed(E, [L(22, 1, 25, 'e2e4 e7e5'), L(22, 2, 22, 'd2d4 d7d5'), L(22, 3, 20, 'g1f3 g8f6')]);
    assert.deepStrictEqual(moves(T.buildList(E, { fen: start, multiPV: 3 }, 'bestmove e2e4')), ['e2e4', 'd2d4', 'g1f3']);
  });
  t('the early-stop history and the exact lines ignore bound lines', () => {
    const E = fresh();
    feed(E, [L(20, 1, 30, 'e2e4 e7e5'), L(21, 1, 31, 'd2d4 d7d5', ' lowerbound')]);
    assert.strictEqual(E.pv[1].move, 'e2e4'); assert.strictEqual(E.hist.length, 1);
    assert.strictEqual(E.last[1].move, 'd2d4');
  });
  t('fewer legal moves than lines asked for', () => {
    const E = fresh(); feed(E, [L(10, 1, 50, 'e2e4'), L(10, 2, 10, 'd2d4')]);
    assert.deepStrictEqual(moves(T.buildList(E, { fen: start, multiPV: 3 }, 'bestmove e2e4')), ['e2e4', 'd2d4']);
  });
  t('a bestmove that is in no line still goes first', () => {
    const E = fresh(); feed(E, [L(20, 1, 30, 'e2e4 e7e5'), L(20, 2, 20, 'd2d4 d7d5'), L(20, 3, 10, 'g1f3 g8f6')]);
    const list = T.buildList(E, { fen: start, multiPV: 3 }, 'bestmove b1c3');
    assert.strictEqual(list[0].move, 'b1c3'); assert.strictEqual(list.length, 3);
  });
}

// ── human context ──
{
  const { T } = load(file);
  t('slip chance rises with a short clock', () => {
    const a = T.humanContext(300000).pbMul, b = T.humanContext(10000).pbMul, c = T.humanContext(null).pbMul;
    assert.ok(a === 1 && c === 1 && b > 2, [a, b, c].join(' '));
  });
  t('humanPick uses pbMul: a huge multiplier makes it slip, pbMul 1 at pb 0 never does', () => {
    const st = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' };
    const list = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'a2a3'].map((m, i) => ({ move: m, pv: [m], scoreRaw: 30 - i * 40, mateScore: null, side: 'w' }));
    const P = { d: 3, k: 5, T: 80, pb: 0.5, notice: 1 };
    let slips = 0; const r = rng(11);
    for (let i = 0; i < 400; i++) { const p = T.humanPick(st, list, P, r, { pbMul: 1.8 }); if (p[0].slip) slips++; }
    assert.ok(slips > 150, 'slips with pb 0.5 x 1.8: ' + slips);
    let none = 0; for (let i = 0; i < 400; i++) { const p = T.humanPick(st, list, Object.assign({}, P, { pb: 0 }), r, { pbMul: 5 }); if (p[0].slip) none++; }
    assert.strictEqual(none, 0);
  });
}

console.log(bad ? bad + ' FAILED' : 'all passed');
process.exit(bad ? 1 : 0);
