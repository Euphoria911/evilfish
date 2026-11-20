// The bridge server (tools/bridge) end to end, then the userscript's bridge client against it.
// Uses the multi-thread WASM engine from node_modules, with two threads and a small hash.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { load } = require('./harness.js');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const root = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const call = (method, p, body, headers = { 'X-Evilfish': '1' }) => new Promise((resolve, reject) => {
  const req = http.request(BASE + p, { method, headers }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

let bad = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) bad++; };

(async () => {
  const bridge = spawn(process.execPath, [path.join(root, 'tools', 'bridge', 'evilfish-bridge.js'), '--port', String(PORT), '--threads', '2', '--hash', '32'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; bridge.stdout.on('data', d => out += d); bridge.stderr.on('data', d => out += d);
  try {
    for (let i = 0; i < 50 && !out.includes('on http'); i++) await sleep(100);
    ok('bridge starts', out.includes('on http'), out);

    // ── access control ──
    ok('no header -> 403', (await call('GET', '/hello', null, {})).status === 403);
    const badHost = await new Promise(resolve => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: '/hello', headers: { 'X-Evilfish': '1', Host: 'evil.example' } }, res => resolve(res.statusCode));
      r.end();
    });
    ok('foreign Host header -> 403 (DNS rebinding)', badHost === 403, String(badHost));
    const pre = await call('OPTIONS', '/hello', null, { Origin: 'https://www.chess.com', 'Access-Control-Request-Headers': 'x-evilfish' });
    ok('CORS preflight refused', pre.status === 403, String(pre.status));

    const hello = JSON.parse((await call('GET', '/hello')).body);
    ok('hello', hello.name === 'evilfish-bridge' && hello.threads === 2, JSON.stringify(hello));

    // ── a raw session ──
    const id = JSON.parse((await call('POST', '/session', '')).body).id;
    const acc = JSON.parse((await call('POST', `/cmd?s=${id}`, 'quit\nsetoption name SyzygyPath value /etc\nsetoption name Hash value 99999\nsetoption name Threads value 64\nsetoption name Debug Log File value /tmp/x\nposition fen $(id) w - - 0 1\nuci\nisready')).body);
    ok('whitelist: only uci + isready accepted', acc.accepted === 2, JSON.stringify(acc));
    let seq = 0, lines = [];
    const pollUntil = async (re, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const r = JSON.parse((await call('GET', `/poll?s=${id}&since=${seq}`)).body);
        seq = r.seq; lines.push(...r.lines);
        if (lines.some(l => re.test(l))) return true;
      }
      return false;
    };
    ok('uciok + readyok', (await pollUntil(/^readyok/)) && lines.some(l => l === 'uciok'));
    await call('POST', `/cmd?s=${id}`, 'ucinewgame\nposition startpos moves e2e4 e7e5\ngo depth 10');
    lines = [];
    ok('search answers with bestmove', await pollUntil(/^bestmove [a-h][1-8][a-h][1-8]/));
    ok('info lines carry multipv scores', lines.some(l => /^info depth \d+ .*score cp -?\d+/.test(l)));
    const again = JSON.parse((await call('GET', `/poll?s=${id}&since=${seq}`)).body);
    ok('long poll after the last line returns empty, not a repeat', again.lines.length === 0 || again.lines.every(l => !lines.includes(l)) );
    ok('delete', JSON.parse((await call('DELETE', `/session?s=${id}`)).body).ok === true);
    ok('session gone', (await call('POST', `/cmd?s=${id}`, 'uci')).status === 404);

    // ── session limit: orphans (a reloaded page) make room, live sessions do not ──
    const bridge2Port = PORT + 1;
    const b2 = spawn(process.execPath, [path.join(root, 'tools', 'bridge', 'evilfish-bridge.js'), '--port', String(bridge2Port), '--threads', '1', '--hash', '16', '--sessions', '2', '--stale', '4000'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const call2 = (method, p, body) => new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${bridge2Port}` + p, { method, headers: { 'X-Evilfish': '1' } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        req.on('error', reject); if (body) req.write(body); req.end();
      });
      for (let i = 0; i < 50 && (await call2('GET', '/hello').catch(() => ({ status: 0 }))).status !== 200; i++) await sleep(100);
      const s1 = JSON.parse((await call2('POST', '/session', '')).body).id;
      const s2 = JSON.parse((await call2('POST', '/session', '')).body).id;
      ok('third session is refused while the first two are fresh', (await call2('POST', '/session', '')).status === 500);
      await sleep(4600);
      const keep = call2('GET', `/poll?s=${s2}&since=0`);              // s2 has a live poller, s1 is an orphan
      await sleep(200);
      const r3 = await call2('POST', '/session', '');
      ok('a stale session (untouched for the stale time, nobody polling) is taken over', r3.status === 200, r3.body);
      ok('the polled session survives', (await call2('POST', `/cmd?s=${s2}`, 'isready')).status === 200);
      ok('the orphan is gone', (await call2('POST', `/cmd?s=${s1}`, 'isready')).status === 404);
      await call2('DELETE', `/session?s=${s2}`); await keep.catch(() => {});
    } finally { b2.kill('SIGTERM'); }

    // ── adoption: a reloaded page names its old session and takes over the running engine instead of starting another ──
    {
      const idA = JSON.parse((await call('POST', '/session', '')).body).id;
      let seqA = 0;
      const pollA = async re => { for (let i = 0; i < 100; i++) { const r = JSON.parse((await call('POST', `/x?s=${idA}&since=${seqA}`, i === 0 ? 'uci\nisready' : '')).body); seqA = r.seq; if (r.lines.some(l => re.test(l))) return true; } return false; };
      ok('first session handshakes', await pollA(/^readyok/));
      const tA = Date.now();
      const idB = JSON.parse((await call('POST', `/session?adopt=${idA}`, '')).body).id;
      let seqB = 0, got = [];
      await call('POST', `/x?s=${idB}&since=0`, 'uci\nisready');
      for (let i = 0; i < 40 && !got.includes('readyok'); i++) { const r = JSON.parse((await call('POST', `/x?s=${idB}&since=${seqB}`, '')).body); seqB = r.seq; got.push(...r.lines); }
      const dtB = Date.now() - tA;
      ok('adopting by id: handshake in well under an engine start-up, no stray lines from the old session', got.includes('readyok') && !got.some(l => l.startsWith('bestmove')) && dtB < 1500, `${dtB} ms ${JSON.stringify(got.slice(0, 3))}`);
      ok('the old id is gone', (await call('POST', `/x?s=${idA}&since=0`, '')).status === 404);
      ok('ping keeps a session alive', JSON.parse((await call('GET', `/ping?s=${idB}`)).body).ok === true);
      ok('an idle poll holds for 1.5 s at most (Tampermonkey runs one request at a time)', await (async () => { const t0 = Date.now(); await call('POST', `/x?s=${idB}&since=${seqB}`, ''); const dt = Date.now() - t0; return dt >= 1000 && dt < 2500; })());
      await call('DELETE', `/session?s=${idB}`);
    }

    // ── the userscript's client ──
    // A GM_xmlhttpRequest like Tampermonkey's: ONE request at a time (the next waits for the previous to finish),
    // abortable. This is what exposed the 20 s command delay under the real extension.
    const queue = []; let running = false; let maxConcurrent = 0;
    const pump = () => {
      if (running || !queue.length) return;
      const job = queue.shift(); if (job.aborted) return pump();
      running = true; maxConcurrent = Math.max(maxConcurrent, 1);
      const ctl = new AbortController(); job.ctl = ctl;
      const finish = () => { running = false; pump(); };
      fetch(job.o.url, { method: job.o.method, headers: job.o.headers, body: job.o.data, signal: ctl.signal })
        .then(async r => { job.o.onload({ status: r.status, responseText: await r.text() }); finish(); })
        .catch(e => { if (job.aborted) { job.o.onabort && job.o.onabort(); } else job.o.onerror(); finish(); });
    };
    const gm = {
      GM_getValue: k => (k === 'eni-bridge' ? BASE : undefined),
      GM_setValue() {},
      GM_xmlhttpRequest: o => {
        const job = { o, aborted: false, ctl: null };
        queue.push(job); pump();
        return { abort: () => { job.aborted = true; if (job.ctl) job.ctl.abort(); else { o.onabort && o.onabort(); } } };
      },
    };
    const { T, ef } = load(path.join(root, 'evilfish.user.js'), gm);
    ok('client probe finds the bridge', await T.probeBridge() === true && T.bridgeState.info.threads === 2);
    const E = await T.startWorker('bridge', 'active');
    for (let i = 0; i < 100 && !E.ready; i++) await sleep(100);
    ok('client handshake: engine ready through the bridge', E.ready === true && E.state === 'idle');
    ef.accuracy = 0;
    const st = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', startFEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], atEnd: true };
    const job = T.makeJob(st, { ponder: true }); job.movetime = 700; job.multiPV = 3;
    T.requestSearch(job);
    for (let i = 0; i < 80 && !E.ponderResults.has(st.fen); i++) await sleep(100);
    const list = E.ponderResults.get(st.fen);
    ok('client search: three lines, legal moves, searched to a real depth', list && list.length === 3 && list.every(e => T.plausibleMove(st.fen, e.move)) && list[0].depth >= 14, JSON.stringify(list && list.map(e => [e.move, e.depth])));
    // regression (found under the real Tampermonkey): it runs ONE request at a time across tabs, so a held poll in one tab
    // delayed another tab's commands by the whole hold time (20 s)
    {
      const { T: T2 } = load(path.join(root, 'evilfish.user.js'), gm);          // a second "tab", the same request queue
      await T2.probeBridge();
      const E2 = await T2.startWorker('bridge', 'active');
      for (let i = 0; i < 150 && !E2.ready; i++) await sleep(100);
      ok('second tab handshakes while the first has a search running', E2.ready === true);
      E.worker.postMessage('position startpos');
      E.worker.postMessage('go depth 99 movetime 6000');                          // tab one is now polling for its bestmove
      await sleep(500);
      const t1 = Date.now();
      let got = false; const prevHandler = E2.worker.onmessage;
      E2.worker.onmessage = ev => { if (ev.data === 'readyok') got = true; prevHandler(ev); };
      E2.worker.postMessage('isready');
      for (let i = 0; i < 100 && !got; i++) await sleep(50);
      const dt1 = Date.now() - t1;
      ok('a command in the second tab is delayed by at most one poll hold, not 20 s', got && dt1 < 2600, `${dt1} ms`);
      E.worker.postMessage('stop');
      await sleep(300);
      E2.worker.terminate();
    }
    // regression: with the idle poll pending (nothing to do for a few seconds) a command must still go out at once
    await sleep(2500);
    const t0 = Date.now();
    const job2 = T.makeJob(st, { ponder: true }); job2.movetime = 200; job2.multiPV = 1; job2.fen = st.fen + ' '; job2.st = st;
    E.ponderResults.clear();
    T.requestSearch(Object.assign(job2, { fen: st.fen }));
    for (let i = 0; i < 100 && !E.ponderResults.has(st.fen); i++) await sleep(25);
    const dt = Date.now() - t0;
    ok('a command sent while the idle poll is pending is not held up by it (one-request-at-a-time client)', E.ponderResults.has(st.fen) && dt < 1500, 'took ' + dt + ' ms');
    E.worker.terminate();
  } catch (e) {
    console.log('FAIL exception', e && e.stack || e); bad++;
  } finally {
    bridge.kill('SIGTERM');
    await sleep(300);
  }
  console.log(bad ? bad + ' FAILED' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
