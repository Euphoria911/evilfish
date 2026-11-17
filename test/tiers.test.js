const { load } = require('./harness.js');
const { T, ef } = load(require('path').join(__dirname, '..', 'evilfish.user.js'));
const assert = require('assert');
const want = {
  100: ['UCI_LimitStrength value false', 'Skill Level value 20'],
  80:  ['Skill Level value 20', 'UCI_LimitStrength value true', 'UCI_Elo value 2200'],
  70:  ['Skill Level value 20', 'UCI_LimitStrength value true', 'UCI_Elo value 2000'],
  60:  ['Skill Level value 20', 'UCI_LimitStrength value true', 'UCI_Elo value 1700'],
  45:  ['UCI_LimitStrength value false', 'Skill Level value 2'],
  30:  ['UCI_LimitStrength value false', 'Skill Level value 1'],
  20:  ['UCI_LimitStrength value false', 'Skill Level value 0'],
};
let bad = 0;
const tiers = [100, 80, 70, 60, 45, 30, 20];
tiers.forEach((acc, i) => {
  ef.accuracy = i; ef.human = false;
  const sent = []; const E = { worker: { postMessage: c => sent.push(c) }, strengthDirty: true };
  T.applyStrength(E);
  const joined = sent.join(' | ');
  const ok = want[acc].every(w => joined.includes(w)) && E.strengthDirty === false;
  console.log((ok ? 'ok   ' : 'FAIL ') + acc + '%  ' + sent.map(c => c.replace('setoption name ', '')).join(' ; '));
  if (!ok) bad++;
  // job depth sanity
  const st = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', startFEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [] };
  const j = T.makeJob(st); console.log('       job depth', j.depth, 'multiPV', j.multiPV, 'human', !!j.human);
});
// human mode still sends full-strength options
ef.accuracy = 2; ef.human = true;
const sent2 = []; T.applyStrength({ worker: { postMessage: c => sent2.push(c) } });
const hum = sent2.join(' | ');
if (!(hum.includes('UCI_LimitStrength value false') && hum.includes('Skill Level value 20'))) { console.log('FAIL human mode strength options: ' + hum); bad++; } else console.log('ok   human mode: full-strength engine options');
console.log(bad ? bad + ' FAILED' : 'all passed');
process.exitCode = bad ? 1 : 0;
