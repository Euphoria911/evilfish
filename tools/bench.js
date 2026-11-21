#!/usr/bin/env node
// Benchmarks for choosing the bridge's settings.
//   node tools/bench.js nps  [threads,threads,...]     nodes per second by thread count (middlegame position, 3 s each)
//   node tools/bench.js hash [MB,MB,...] [threads]     time for `ucinewgame` + `isready` by hash size
//   node tools/bench.js latency [port]                 round trip through a running bridge: isready, and a 50 ms search's overshoot
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FEN = 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2P1PN2/PP1NBPPP/R2Q1RK1 w - - 0 9';
const BIN = path.join(__dirname, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19.js');

// EF_ENGINE=/path/to/native/stockfish benchmarks a native engine instead of the WASM build run by Node
function engine() {
  const p = process.env.EF_ENGINE ? spawn(process.env.EF_ENGINE, [], { stdio: ['pipe', 'pipe', 'ignore'] })
                                  : spawn(process.execPath, ['--no-warnings', BIN], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = ''; const waiters = [];
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); for (const w of waiters.slice()) w(l); } });
  const send = c => p.stdin.write(c + '\n');
  const until = (test, on) => new Promise(r => { const w = l => { if (on) on(l); if (test(l)) { waiters.splice(waiters.indexOf(w), 1); r(l); } }; waiters.push(w); });
  return { send, until, quit: () => { try { send('quit'); p.kill(); } catch (e) {} } };
}

const call = (port, method, p, body) => new Promise((resolve, reject) => {
  const req = http.request(`http://127.0.0.1:${port}` + p, { method, headers: { 'X-Evilfish': '1' } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
  req.on('error', reject); if (body) req.write(body); req.end();
});

(async () => {
  const mode = process.argv[2] || 'nps';
  if (mode === 'nps') {
    const list = (process.argv[3] || '1,4,6,8,12,16,20,24').split(',').map(Number);
    for (const t of list) {
      const E = engine();
      E.send('uci'); await E.until(l => l === 'uciok');
      E.send(`setoption name Threads value ${t}`); E.send('setoption name Hash value 1024'); E.send('isready'); await E.until(l => l === 'readyok');
      E.send(`position fen ${FEN}`); E.send('go movetime 3000');
      let last = '';
      await E.until(l => l.startsWith('bestmove'), l => { if (/^info depth \d+ .* nps \d+/.test(l)) last = l; });
      const nps = +(last.match(/ nps (\d+)/) || [])[1], depth = +(last.match(/depth (\d+)/) || [])[1];
      console.log(`threads ${String(t).padStart(2)}: ${(nps / 1e6).toFixed(2)} Mnps, depth ${depth} in 3 s`);
      E.quit(); await sleep(500);
    }
  } else if (mode === 'hash') {
    const list = (process.argv[3] || '128,256,512,1024,2048').split(',').map(Number);
    const threads = +(process.argv[4] || 12);
    for (const mb of list) {
      const E = engine();
      E.send('uci'); await E.until(l => l === 'uciok');
      E.send(`setoption name Threads value ${threads}`); E.send(`setoption name Hash value ${mb}`); E.send('isready'); await E.until(l => l === 'readyok');
      const times = [];
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now(); E.send('ucinewgame'); E.send('isready'); await E.until(l => l === 'readyok'); times.push(Date.now() - t0);
      }
      console.log(`hash ${String(mb).padStart(4)} MB, ${threads} threads: ucinewgame+isready ${times.join(' / ')} ms`);
      E.quit(); await sleep(500);
    }
  } else if (mode === 'latency') {
    const port = +(process.argv[3] || 8765);
    const hello = JSON.parse(await call(port, 'GET', '/hello'));
    console.log('bridge', JSON.stringify(hello));
    let t0 = Date.now();
    const id = JSON.parse(await call(port, 'POST', '/session', '')).id;
    let seq = 0;
    const poll = async (re, ms = 20000) => { const end = Date.now() + ms; for (;;) { const r = JSON.parse(await call(port, 'GET', `/poll?s=${id}&since=${seq}`)); seq = r.seq; if (r.lines.some(l => re.test(l))) return Date.now(); if (Date.now() > end) throw new Error('timeout'); } };
    await call(port, 'POST', `/cmd?s=${id}`, 'uci\nsetoption name MultiPV value 1\nisready');
    await poll(/^readyok/);
    console.log(`session start to readyok: ${Date.now() - t0} ms`);
    const rtt = [];
    for (let i = 0; i < 30; i++) { const a = Date.now(); await call(port, 'POST', `/cmd?s=${id}`, 'isready'); await poll(/^readyok/); rtt.push(Date.now() - a); }
    rtt.sort((a, b) => a - b);
    console.log(`isready round trip (cmd POST + long poll): median ${rtt[15]} ms, p90 ${rtt[27]} ms, max ${rtt[29]} ms`);
    const over = [];
    for (let i = 0; i < 20; i++) {
      await call(port, 'POST', `/cmd?s=${id}`, 'ucinewgame\nisready'); await poll(/^readyok/);
      const a = Date.now(); await call(port, 'POST', `/cmd?s=${id}`, 'position startpos moves e2e4 e7e5\ngo movetime 50'); await poll(/^bestmove/); over.push(Date.now() - a - 50);
    }
    over.sort((a, b) => a - b);
    console.log(`go movetime 50 overshoot (everything but the search): median ${over[10]} ms, p90 ${over[18]} ms, max ${over[19]} ms`);
    await call(port, 'DELETE', `/session?s=${id}`);
  }
  process.exit(0);
})();
