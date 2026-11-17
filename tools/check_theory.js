// spot-check theory entries (new ones from the wide pass) against a 3 s reference search
const fs = require('fs');
const { Chess } = require('chess.js');
const { spawn } = require('child_process');
const path = require('path');
const ENGINE = path.join(__dirname, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19-single.js');
const wide = JSON.parse(fs.readFileSync(process.env.WIDE || 'theory_wide.json', 'utf8'));
const first = new Set(JSON.parse(fs.readFileSync(process.env.FIRST || require('path').join(__dirname, '..', 'data', 'theory_book.json'), 'utf8')).map(e => e[0]));
const fresh = wide.filter(e => !first.has(e[0]));
let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const sample = fresh.sort(() => rnd() - 0.5).slice(0, +process.argv[2] || 60);
const p = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '', waiters = [];
p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); waiters.slice().forEach(w => w(l)); } });
const send = c => p.stdin.write(c + '\n');
const until = (t, on) => new Promise(r => { const w = l => { if (on) on(l); if (t(l)) { waiters = waiters.filter(x => x !== w); r(l); } }; waiters.push(w); });
async function search(fen, ms) { send('ucinewgame'); send('position fen ' + fen); send('go movetime ' + ms); let cp = 0, mate = null; await until(l => l.startsWith('bestmove'), l => { const m = l.match(/^info depth \d+.* score (cp|mate) (-?\d+)/); if (m && !/bound/.test(l)) { cp = m[1] === 'cp' ? +m[2] : (+m[2] > 0 ? 10000 - +m[2] : -10000 - +m[2]); } }); return cp; }
async function best(fen, ms) { send('ucinewgame'); send('position fen ' + fen); send('go movetime ' + ms); let mv = ''; await until(l => l.startsWith('bestmove'), l => { if (l.startsWith('bestmove')) mv = l.split(' ')[1]; }); return mv; }
(async () => {
  send('uci'); await until(l => l === 'uciok'); send('setoption name Hash value 256'); send('isready'); await until(l => l === 'readyok');
  let agree = 0, loss = 0, big = 0; const bad = [];
  for (const [key, mv] of sample) {
    const fen = key + ' - 0 1';
    const ref = await best(fen, 3000);
    if (ref === mv) { agree++; continue; }
    const refEval = await search(fen, 1500);            // side-to-move POV of the reference line
    const g = new Chess(fen); g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] });
    const childEval = -(await search(g.fen(), 1500));
    const l = Math.max(0, refEval - childEval);
    loss += l; if (l > 60) { big++; bad.push(`${key.split(' ')[0].slice(0, 30)}… ${mv} vs ${ref} (-${l}cp)`); }
  }
  console.log({ sampled: sample.length, agreeWith3sReference: (100 * agree / sample.length).toFixed(0) + '%', avgCpLoss: Math.round(loss / sample.length), movesLosingOver60cp: big });
  if (bad.length) console.log(bad.slice(0, 5).join('\n'));
  p.kill();
})();
