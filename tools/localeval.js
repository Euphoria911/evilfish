// Local Stockfish 19 (full, single thread) as a stand-in for lichess cloud-eval: same output shape,
// scores from White's point of view, castling normalised by the caller.
const { spawn } = require('child_process');
const path = require('path');
const ENGINE = path.join(__dirname, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19-single.js');

let proc = null, buf = '', waiters = [];
function start() {
  proc = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] });
  proc.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); waiters.slice().forEach(w => w(line)); }
  });
}
const send = c => proc.stdin.write(c + '\n');
const until = (test, onLine) => new Promise(res => {
  const w = line => { if (onLine) onLine(line); if (test(line)) { waiters = waiters.filter(x => x !== w); res(line); } };
  waiters.push(w);
});

let ready = null;
async function init() {
  if (ready) return ready;
  ready = (async () => {
    start();
    send('uci'); await until(l => l === 'uciok');
    send('setoption name Hash value 256'); send('setoption name MultiPV value 5'); send('isready'); await until(l => l === 'readyok');
  })();
  return ready;
}

// returns { depth, pvs: [{ move, cp, mate }] } with cp/mate from White's point of view
async function evalFen(fen, ms = 1500) {
  await init();
  const turn = fen.split(' ')[1];
  const sign = turn === 'w' ? 1 : -1;
  send('ucinewgame'); send('position fen ' + fen); send(`go movetime ${ms}`);
  const pv = {};
  let depth = 0;
  await until(l => l.startsWith('bestmove'), line => {
    const m = line.match(/^info depth (\d+).* multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/);
    if (m && !/(lowerbound|upperbound)/.test(line)) {
      depth = Math.max(depth, +m[1]);
      pv[+m[2]] = { move: m[5], cp: m[3] === 'cp' ? +m[4] * sign : undefined, mate: m[3] === 'mate' ? +m[4] * sign : undefined };
    }
  });
  const pvs = Object.keys(pv).sort((a, b) => a - b).map(k => pv[k]);
  return { depth, pvs };
}
function stop() { try { proc && proc.kill(); } catch (e) {} }
module.exports = { evalFen, stop };
