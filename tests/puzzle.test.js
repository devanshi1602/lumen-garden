const P = require('../src/puzzle.js');
const assert = require('assert');
let t0 = Date.now(), worst = 0;
// handcrafted
P.LEVELS.forEach((_, i) => { const lv = P.level(i); assert(!P.simulate(lv).solved); assert(P.nearestSolution(lv)); });
// daily for a year + endless
const d = new Date(2026, 9, 1);
for (let k = 0; k < 365; k++) {
  const s = Date.now();
  const lv = P.daily(new Date(d.getTime() + k * 864e5));
  worst = Math.max(worst, Date.now() - s);
  assert(lv.daily, 'fallback used on day ' + k);
  assert(!P.simulate(lv).solved);
  const near = P.nearestSolution(lv); assert(near && near.flips >= 4);
  // hint loop must reach a solution
  let guard = 0;
  while (!P.simulate(lv).solved && guard++ < 30) { const h = P.hint(lv); assert(h >= 0); lv.mirrors[h].o ^= 1; }
  assert(P.simulate(lv).solved, 'hint loop failed day ' + k);
}
for (let n = 0; n < 40; n++) { const lv = P.endless(n); assert(lv.endless === n, 'endless fallback ' + n); }
// determinism
assert.deepStrictEqual(P.toRows(P.daily(d)), P.toRows(P.daily(d)));
console.log('OK', (Date.now() - t0) + 'ms total, worst daily gen', worst + 'ms');
console.log(P.toRows(P.daily(new Date(2026, 9, 22))).join('\n'));
