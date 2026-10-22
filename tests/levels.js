const P = require('../src/puzzle.js');
P.LEVELS.forEach((L, i) => {
  const lv = P.level(i);
  const s = P.simulate(lv);
  const near = P.nearestSolution(lv);
  console.log(i, L.name, 'mirrors', lv.mirrors.length, 'seeds', lv.seeds.length, 'solvedInitially', s.solved,
    near ? `minFlips ${near.flips} solutions ${near.count}` : 'UNSOLVABLE');
});
