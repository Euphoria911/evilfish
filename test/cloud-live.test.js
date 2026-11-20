// Network test: the script's cloud lookup path (queue, one request at a time, parsing, caching) against the real lichess API,
// with a GM_xmlhttpRequest built on Node's fetch (no CORS in Node, like Tampermonkey's background request).
const path = require('path');
const assert = require('assert');
const { Chess } = require('chess.js');
const { load } = require('./harness.js');
let inflight = 0, maxInflight = 0, requests = 0, statuses = {};
const gm = {
  GM_getValue: () => undefined, GM_setValue() {},
  GM_xmlhttpRequest: o => {
    inflight++; requests++; maxInflight = Math.max(maxInflight, inflight);
    const t0 = Date.now();
    fetch(o.url, { method: o.method, headers: o.headers, signal: AbortSignal.timeout(o.timeout || 5000) })
      .then(async r => { inflight--; statuses[r.status] = (statuses[r.status] || 0) + 1; o.onload({ status: r.status, responseText: await r.text(), ms: Date.now() - t0 }); })
      .catch(e => { inflight--; (e.name === 'TimeoutError' ? o.ontimeout : o.onerror)(); });
  }
};
const { T } = load(path.join(__dirname, '..', 'evilfish.user.js'), gm);
const lines = ['e2e4 e7e5 g1f3 b8c6 f1b5 a7a6', 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6', 'c2c4 e7e5 b1c3 g8f6', 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4'];
const fens = [];
for (const l of lines) { const c = new Chess(); fens.push(c.fen()); for (const m of l.split(' ')) { c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); fens.push(c.fen()); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let got = 0, hits = 0, legal = 0, blockedSeen = false;
  const t0 = Date.now();
  for (const fen of fens.slice(0, 14)) {
    T.cloud.gen++;                                           // each position is "the current one", as in a game
    await new Promise(resolve => T.lookupCloud(fen, data => {
      got++;
      if (data && data.pvs) {
        hits++;
        const e = T.cloudEntries(fen, data);
        if (e.length && e.every(x => T.plausibleMove(fen, x.move))) legal++;
      }
      if (T.cloud.blockedUntil > Date.now()) blockedSeen = true;
      resolve();
    }));
    await sleep(120);
  }
  // warm-ups queued behind each other, then the position that is actually played jumps the queue
  const w = fens.slice(14, 17);
  for (const f of w) T.lookupCloud(f);
  T.cloud.gen++;
  let urgentAt = -1, order = [];
  await new Promise(resolve => T.lookupCloud(w[2], () => { urgentAt = Date.now() - t0; resolve(); }));
  console.log({ elapsedMs: Date.now() - t0, lookups: got, answered: hits, allMovesPlausible: legal, requests, maxInflight, statuses, cacheSize: T.cloud.cache.size, blockedSeen });
  assert.strictEqual(maxInflight, 1, 'never more than one request in flight');
  assert.ok(got === 14, 'every awaited lookup called back');
  if (blockedSeen) { console.log('lichess answered 429 during the test; skipping the data assertions'); process.exit(0); }
  assert.ok(hits >= 10, 'most opening positions are in the cloud: ' + hits);
  assert.strictEqual(legal, hits, 'every cloud answer yields playable moves');
  console.log('all passed');
  process.exit(0);
})();
