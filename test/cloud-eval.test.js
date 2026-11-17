// Validate cloud-eval handling against real lichess data: castling normalisation, legality of every PV, score sign.
const { Chess } = require('chess.js');
const { load } = require('./harness.js');
const { T } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));

const lines = [
  'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 e1g1',             // Italian, castles soon
  'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1',
  'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3',
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6',
  'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7',
  'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uci = m => m.from + m.to + (m.promotion || '');

(async () => {
  let total = 0, hit = 0, miss = 0, badFirst = 0, badPV = 0, castleFixed = 0, errors = 0;
  const signIssues = [];
  for (const line of lines) {
    const g = new Chess();
    const moves = line.split(' ');
    for (let ply = 0; ply <= moves.length; ply++) {
      const fen = g.fen();
      total++;
      let data = null;
      try {
        const r = await fetch('https://lichess.org/api/cloud-eval?multiPv=3&fen=' + encodeURIComponent(fen));
        if (r.status === 200) data = await r.json();
        else if (r.status === 429) { errors++; await sleep(5000); }
      } catch (e) { errors++; }
      await sleep(350);
      if (!data) { miss++; }
      else {
        hit++;
        const entries = T.cloudEntries(fen, data);
        if (!entries.length) badFirst++;
        for (const e of entries) {
          // every PV must be playable from this position
          const c = new Chess(fen);
          let ok = true;
          for (const mv of e.pv.slice(0, 10)) {
            let res = null;
            try { res = c.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] }); } catch (x) {}
            if (!res) { ok = false; break; }
          }
          if (!ok) { badPV++; console.log('BAD PV', fen, e.pv.slice(0, 6).join(' ')); }
          const raw = data.pvs[entries.indexOf(e)].moves.split(' ').slice(0, 10).join(' ');
          if (raw !== e.pv.slice(0, 10).join(' ')) castleFixed++;
          if (!T.plausibleMove(fen, e.move)) badFirst++;
        }
        // score sign: side to move perspective -> for the best line, applying it should not contradict (loose check)
        const e0 = entries[0];
        if (e0 && Number.isInteger(e0.scoreRaw) && Math.abs(e0.scoreRaw) > 150) signIssues.push(`${fen.split(' ').slice(0, 2).join(' ')} cp=${e0.scoreRaw}`);
      }
      if (ply < moves.length) g.move({ from: moves[ply].slice(0, 2), to: moves[ply].slice(2, 4), promotion: moves[ply][4] });
    }
  }
  console.log({ total, hit, miss, errors, badFirst, badPV, pvsWithCastlingRewritten: castleFixed });
  console.log('large evals (eyeball sign):', signIssues.slice(0, 6));
})();
