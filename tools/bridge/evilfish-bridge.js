#!/usr/bin/env node
// Evilfish local engine bridge.
//
// Runs Stockfish on this machine (a native binary when there is one, otherwise the multi-thread WASM build from the
// `stockfish` npm package, run by Node) and exposes it to the userscript over plain HTTP on 127.0.0.1. The userscript
// reaches it with GM_xmlhttpRequest, so the engine never runs inside the chess page: no WASM, no worker, no
// multi-megabyte downloads in the page, and 10-20x more nodes per second than the in-page single-thread build.
//
// Protocol (all requests need the header `X-Evilfish: 1`; the Host header must be 127.0.0.1 or localhost):
//   GET    /hello                  -> {name, version, engine, threads, hash}
//   POST   /session                -> {id}                 starts an engine process
//   POST   /x?s=ID&since=N (text) -> {lines, seq, dead}   commands in the body (filtered through a whitelist), output after seq N
//                                                         in the answer; an empty body is a poll that holds <= 1.5 s
//   GET    /ping?s=ID              -> {ok}                 keepalive for an idle session
//   POST   /session?adopt=OLDID    -> {id}                 as /session, but takes over OLDID's running engine if it is free
//   POST   /cmd?s=ID    (text)     -> {ok}                 (older, separate command channel)
//   GET    /poll?s=ID&since=N      -> {lines, seq, dead}   (older, separate long poll)
//   DELETE /session?s=ID           -> {ok}                 kills the engine process
//
// Usage: node tools/bridge/evilfish-bridge.js [--port 8765] [--threads N] [--hash MB] [--engine PATH] [--syzygy DIR]
// Environment: EF_PORT, EF_THREADS, EF_HASH, EF_ENGINE, EF_SYZYGY, EF_MAX_SESSIONS.
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const VERSION = '1.0.0';
const arg = (name, env, fallback) => {
  const i = process.argv.indexOf('--' + name);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[env] || fallback;
};

const PORT = Number(arg('port', 'EF_PORT', 8765));
const HOST = '127.0.0.1';
const THREADS = Math.max(1, Number(arg('threads', 'EF_THREADS', Math.min(12, Math.max(1, Math.floor(os.cpus().length / 2))))));
// 256 MB: a 1 GB hash made every engine session about 2.1 GB resident (measured); on a 16 GB laptop with a browser open that
// means swapping, a 6 s engine start and stop answers slower than the client's watchdog. 256 MB holds the nodes of a ~10 s search.
let HASH_MB = Math.max(16, Number(arg('hash', 'EF_HASH', 256)));
const SYZYGY = arg('syzygy', 'EF_SYZYGY', '');
const MAX_SESSIONS = Number(arg('sessions', 'EF_MAX_SESSIONS', 2));
const IDLE_MS = 90000;                    // a live client pings at least every 20 s; an orphan is kept this long for the next page to adopt
// Tampermonkey runs ONE GM_xmlhttpRequest at a time for the whole browser, across tabs: a held request blocks every other
// request, in every tab, until it returns (measured: another tab's 20 s idle poll delayed a game's commands by 15 s). So a
// poll holds for 1.5 s at most, and the client only polls while it is waiting for something.
const POLL_HOLD_MS = 1500;
const STALE_MS = Number(arg('stale', 'EF_STALE_MS', 60000));   // a session nobody has touched for this long may be taken over
const LOG_CMDS = !!arg('log-cmds', 'EF_LOG_CMDS', '');          // print accepted setoption lines (debugging the strength tiers)
const ALLOW_ORIGIN = arg('allow-origin', 'EF_ALLOW_ORIGIN', '');     // testing only: lets a page call the bridge directly

// ── engine selection ────────────────────────────────────────────────────────
function findEngine() {
  const wanted = arg('engine', 'EF_ENGINE', '');
  if (wanted) return { kind: 'native', cmd: wanted, args: [] };
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['stockfish'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return { kind: 'native', cmd: which.stdout.split('\n')[0].trim(), args: [] };
  const roots = [path.join(__dirname, '..', '..'), process.cwd()];
  for (const root of roots) {
    const js = path.join(root, 'node_modules', 'stockfish', 'bin', 'stockfish-19.js');
    if (fs.existsSync(js)) return { kind: 'wasm', cmd: process.execPath, args: ['--no-warnings', js] };
  }
  return null;
}
const ENGINE = findEngine();
// The WASM build cannot allocate more than about 1 GB of hash: asking for 2 GB makes it hang without a word (measured).
if (ENGINE && ENGINE.kind === 'wasm' && HASH_MB > 1024) { console.log(`hash ${HASH_MB} MB is more than the WASM engine can allocate; using 1024`); HASH_MB = 1024; }

// ── command whitelist ───────────────────────────────────────────────────────
// Only what the userscript needs. Threads and Hash are owned by the bridge (the client's values are dropped), and
// nothing that can read or write files (SyzygyPath, EvalFile, Debug Log File...) gets through.
const OPTION_OK = new Set(['multipv', 'skill level', 'uci_limitstrength', 'uci_elo', 'uci_showwdl', 'move overhead', 'ponder', 'uci_chess960']);
const OPTION_DROP = new Set(['hash', 'threads']);
const MOVE = '[a-h][1-8][a-h][1-8][qrbn]?';
const RE_POSITION = new RegExp(`^position (startpos|fen [prnbqkPRNBQK1-8/]+ [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \\d+ \\d+)( moves( ${MOVE})*)?$`);
const RE_GO = new RegExp(`^go( (depth|movetime|nodes|wtime|btime|winc|binc|movestogo|mate) \\d+|( infinite)|( ponder)|( searchmoves( ${MOVE})+))*$`);
const RE_SETOPTION = /^setoption name ([A-Za-z_ ]+?)(?: value ([A-Za-z0-9_.\- ]{0,40}))?$/;

function filterCommand(line) {
  line = line.trim();
  if (!line || line.length > 20000) return null;
  const head = line.split(' ', 1)[0];
  switch (head) {
    case 'uci': case 'isready': case 'ucinewgame': case 'stop': case 'ponderhit':
      return line === head ? line : null;
    case 'position': return RE_POSITION.test(line) ? line : null;
    case 'go': return RE_GO.test(line) ? line : null;
    case 'setoption': {
      const m = RE_SETOPTION.exec(line);
      if (!m) return null;
      const name = m[1].trim().toLowerCase();
      if (OPTION_DROP.has(name)) return null;
      return OPTION_OK.has(name) ? line : null;
    }
    default: return null;
  }
}

// ── sessions ────────────────────────────────────────────────────────────────
const sessions = new Map();
let nextId = 1;

function log(...a) { console.log(new Date().toISOString().slice(11, 23), ...a); }

function killSession(s, why) {
  if (s.dead && !s.child) return;
  s.dead = true;
  try { s.child && s.child.stdin.write('quit\n'); } catch (e) {}
  const child = s.child;
  s.child = null;
  if (child) setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 400);
  flushPollers(s);
  sessions.delete(s.id);
  log(`session ${s.id} closed (${why})`);
}

function flushPollers(s) {
  const waiting = s.pollers.splice(0);
  for (const w of waiting) w();
}

// An orphaned session (its page was reloaded, or its client restarted) still has a running, initialised engine. Starting
// an engine takes seconds (about 0.2 s per thread on top of 1.7 s, more under memory pressure) and hundreds of MB, so the
// next client takes that engine over instead: stop, drain until the engine answers `isready`, clear the output buffer.
async function adoptOrphan(wantedId) {
  const free = x => !x.dead && x.child && x.pollers.length === 0;
  let s = wantedId ? sessions.get(wantedId) : null;                                     // a reloaded page names its old session
  if (s && !free(s)) s = null;
  if (!s) s = [...sessions.values()].filter(x => free(x) && Date.now() - x.touched > STALE_MS).sort((a, b) => b.touched - a.touched)[0];
  if (!s) return null;
  s.pollers = []; s.lines = []; s.base = 0;
  s.child.stdin.write('stop\nisready\n');
  await new Promise(resolve => {
    const t = setTimeout(resolve, 4000);
    const check = () => { if (s.lines.includes('readyok')) { clearTimeout(t); resolve(); } else s.pollers.push(check); };
    check();
  });
  s.pollers = []; s.lines = []; s.base = 0; s.tail = '';
  sessions.delete(s.id);
  s.id = String(nextId++);
  s.touched = Date.now();
  sessions.set(s.id, s);
  log(`session ${s.id} adopted a running engine (no start-up)`);
  return s;
}

async function newSession(adoptId) {
  if (!ENGINE) throw new Error('no engine: install stockfish or run `npm install` in the project');
  const adopted = await adoptOrphan(adoptId);
  if (adopted) return adopted;
  // a page that was reloaded (or a client that gave up) leaves its session behind with nobody polling it; each one holds an
  // engine process of hundreds of MB, so they are reclaimed as soon as a new session is wanted, not only at the limit
  if (sessions.size >= MAX_SESSIONS) throw new Error('too many sessions');
  const id = String(nextId++);
  const child = spawn(ENGINE.cmd, ENGINE.args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const s = { id, child, lines: [], base: 0, pollers: [], dead: false, touched: Date.now(), tail: '' };
  sessions.set(id, s);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    s.tail += chunk;
    const parts = s.tail.split('\n');
    s.tail = parts.pop();
    for (const p of parts) { const l = p.replace(/\r$/, ''); if (l) { s.lines.push(l.slice(0, 4000)); if (LOG_CMDS && /^(bestmove|uciok|readyok)/.test(l)) log(`session ${s.id} -> ${l.slice(0, 30)}`); } }
    if (s.lines.length > 5000) { const drop = s.lines.length - 5000; s.lines.splice(0, drop); s.base += drop; }
    flushPollers(s);
  });
  child.stderr.on('data', () => {});
  child.on('exit', code => { s.child = null; s.dead = true; flushPollers(s); log(`session ${id} engine exited (${code})`); });
  child.on('error', e => { s.child = null; s.dead = true; flushPollers(s); log(`session ${id} engine error: ${e.message}`); });
  // the bridge owns the heavy options
  const init = [`setoption name Threads value ${THREADS}`, `setoption name Hash value ${HASH_MB}`];
  if (SYZYGY) init.push(`setoption name SyzygyPath value ${SYZYGY}`);
  child.stdin.write(init.join('\n') + '\n');
  log(`session ${id} started (${ENGINE.kind}, ${THREADS} threads, ${HASH_MB} MB)`);
  return s;
}

setInterval(() => {
  for (const s of [...sessions.values()]) if (Date.now() - s.touched > IDLE_MS) killSession(s, 'idle');
}, 15000).unref();

// ── http ────────────────────────────────────────────────────────────────────
function send(res, code, obj, extra = {}) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extra));
  res.end(body);
}

function hostOk(req) {
  const h = String(req.headers.host || '').toLowerCase();
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
}

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const cors = ALLOW_ORIGIN && req.headers.origin === ALLOW_ORIGIN
    ? { 'Access-Control-Allow-Origin': ALLOW_ORIGIN, 'Access-Control-Allow-Headers': 'X-Evilfish, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE' }
    : {};
  if (!hostOk(req)) return send(res, 403, { error: 'bad host' });
  if (req.method === 'OPTIONS') { res.writeHead(Object.keys(cors).length ? 204 : 403, cors); return res.end(); }
  if (req.headers['x-evilfish'] !== '1') return send(res, 403, { error: 'missing header' }, cors);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/hello') {
      return send(res, 200, { name: 'evilfish-bridge', version: VERSION, engine: ENGINE ? ENGINE.kind : 'none', threads: THREADS, hash: HASH_MB, syzygy: !!SYZYGY }, cors);
    }
    if (req.method === 'POST' && url.pathname === '/session') {
      await readBody(req);
      const s = await newSession(url.searchParams.get('adopt') || '');
      return send(res, 200, { id: s.id }, cors);
    }
    const s = sessions.get(url.searchParams.get('s') || '');
    if (url.pathname === '/cmd' && req.method === 'POST') {
      if (!s || s.dead || !s.child) return send(res, 404, { error: 'no session' }, cors);
      s.touched = Date.now();
      const body = await readBody(req);
      let n = 0;
      for (const raw of body.split('\n')) {
        const line = filterCommand(raw);
        if (line) { s.child.stdin.write(line + '\n'); n++; if (LOG_CMDS) log(`session ${s.id} <- ${line.slice(0, 60)}`); }
      }
      return send(res, 200, { ok: true, accepted: n }, cors);
    }
    if (url.pathname === '/poll' && req.method === 'GET') {
      if (!s) return send(res, 404, { error: 'no session' }, cors);
      s.touched = Date.now();
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      if (since > s.base) { const drop = Math.min(s.lines.length, since - s.base); s.lines.splice(0, drop); s.base += drop; }   // acknowledged
      const answer = () => {
        const from = Math.max(0, since - s.base);
        const lines = s.lines.slice(from);
        send(res, 200, { lines, seq: s.base + s.lines.length, dead: s.dead && !lines.length }, cors);
      };
      if (s.base + s.lines.length > since || s.dead) return answer();
      let finished = false;
      const wake = () => { if (finished) return; finished = true; clearTimeout(timer); s.touched = Date.now(); answer(); };
      const timer = setTimeout(wake, POLL_HOLD_MS);
      s.pollers.push(wake);
      req.on('close', () => { finished = true; clearTimeout(timer); s.touched = Date.now(); s.pollers = s.pollers.filter(w => w !== wake); });
      return;
    }
    // One request does both jobs: its body carries commands, its answer carries output. Tampermonkey runs one
    // GM_xmlhttpRequest at a time, so a separate held poll would block every command behind it (measured: a command
    // arrived exactly one hold time, 20 s, late). A request with commands answers at once; an empty one is the long poll,
    // and the client aborts it the moment it has a command to send.
    if (url.pathname === '/ping' && req.method === 'GET') {
      if (!s) return send(res, 404, { error: 'no session' }, cors);
      s.touched = Date.now();
      return send(res, 200, { ok: true, dead: s.dead }, cors);
    }
    if (url.pathname === '/x' && req.method === 'POST') {
      if (!s) return send(res, 404, { error: 'no session' }, cors);
      s.touched = Date.now();
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      const body = await readBody(req);
      if (since > s.base) { const drop = Math.min(s.lines.length, since - s.base); s.lines.splice(0, drop); s.base += drop; }
      let sent = 0;
      if (body && !s.dead && s.child) {
        for (const raw of body.split('\n')) {
          const line = filterCommand(raw);
          if (line) { s.child.stdin.write(line + '\n'); sent++; if (LOG_CMDS) log(`session ${s.id} <- ${line.slice(0, 60)}`); }
        }
      }
      const arrived = Date.now();
      const answer = () => {
        const from = Math.max(0, since - s.base);
        const lines = s.lines.slice(from);
        if (LOG_CMDS) log(`session ${s.id} /x since=${since} cmds=${sent} -> ${lines.length} lines after ${Date.now() - arrived} ms${lines.length ? ' [' + lines[0].slice(0, 20) + ']' : ''}`);
        send(res, 200, { lines, seq: s.base + s.lines.length, dead: s.dead && !lines.length, accepted: sent }, cors);
      };
      if (sent || body || s.base + s.lines.length > since || s.dead) return answer();
      let finished = false;
      const wake = () => { if (finished) return; finished = true; clearTimeout(timer); s.touched = Date.now(); answer(); };
      const timer = setTimeout(wake, POLL_HOLD_MS);
      s.pollers.push(wake);
      req.on('close', () => { finished = true; clearTimeout(timer); s.touched = Date.now(); s.pollers = s.pollers.filter(w => w !== wake); });
      return;
    }
    if (url.pathname === '/session' && req.method === 'DELETE') {
      if (s) killSession(s, 'client');
      return send(res, 200, { ok: true }, cors);
    }
    return send(res, 404, { error: 'not found' }, cors);
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) }, cors);
  }
});

function shutdown() { for (const s of [...sessions.values()]) killSession(s, 'shutdown'); setTimeout(() => process.exit(0), 500); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  log(`evilfish-bridge ${VERSION} on http://${HOST}:${PORT}`);
  log(ENGINE ? `engine: ${ENGINE.kind} (${ENGINE.cmd} ${ENGINE.args.join(' ')})` : 'engine: NONE FOUND');
  log(`threads ${THREADS}, hash ${HASH_MB} MB${SYZYGY ? ', syzygy ' + SYZYGY : ''}`);
});
