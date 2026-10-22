/* Lumen Garden — puzzle engine (no dependencies).
 * Grid: x = column (0..w-1, left→right), y = row (0..h-1, far→near the player).
 * Cell types: '.' empty, '#' stone, emitter ('>' '<' '^' 'v'),
 *             '/' or '\\' mirror (rotatable), 'x' crystal (splits beam left+right),
 *             '*' seed (light passes through; blooms when lit).
 */
(function (root) {
  'use strict';

  var DIRS = { '>': [1, 0], '<': [-1, 0], '^': [0, -1], 'v': [0, 1] };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** Parse an array of row strings into a level object. */
  function parse(rows, meta) {
    var h = rows.length, w = rows[0].length;
    var cells = [], mirrors = [], seeds = [], emitters = [];
    for (var y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error('Ragged row ' + y);
      for (var x = 0; x < w; x++) {
        var c = rows[y][x], cell = { x: x, y: y, t: '.' };
        if (c === '#') cell.t = '#';
        else if (DIRS[c]) { cell.t = 'E'; cell.dir = DIRS[c].slice(); emitters.push(cell); }
        else if (c === '/' || c === '\\') { cell.t = 'M'; cell.o = c === '/' ? 0 : 1; cell.mi = mirrors.length; mirrors.push(cell); }
        else if (c === 'x') cell.t = 'X';
        else if (c === '*') { cell.t = 'S'; cell.si = seeds.length; seeds.push(cell); }
        else if (c !== '.') throw new Error('Unknown cell char ' + c);
        cells.push(cell);
      }
    }
    var lv = { w: w, h: h, cells: cells, mirrors: mirrors, seeds: seeds, emitters: emitters };
    if (meta) for (var k in meta) lv[k] = meta[k];
    return lv;
  }

  function toRows(lv) {
    var rows = [];
    for (var y = 0; y < lv.h; y++) {
      var r = '';
      for (var x = 0; x < lv.w; x++) {
        var c = lv.cells[y * lv.w + x];
        if (c.t === '#') r += '#';
        else if (c.t === 'E') r += c.dir[0] === 1 ? '>' : c.dir[0] === -1 ? '<' : c.dir[1] === -1 ? '^' : 'v';
        else if (c.t === 'M') r += c.o === 0 ? '/' : '\\';
        else if (c.t === 'X') r += 'x';
        else if (c.t === 'S') r += '*';
        else r += '.';
      }
      rows.push(r);
    }
    return rows;
  }

  function reflect(o, dx, dy) {
    // '/' : (dx,dy) -> (-dy,-dx)   '\' : (dx,dy) -> (dy,dx)
    return o === 0 ? [-dy, -dx] : [dy, dx];
  }

  /**
   * Trace all beams. orients: optional array overriding mirror orientations.
   * Returns { segs: [[x0,y0,x1,y1],...] in cell units (cell centres at integers),
   *           lit: bool per seed, litCells: Map key->bounces, mirrorsHit: Set of mirror idx }
   */
  function simulate(lv, orients) {
    var w = lv.w, h = lv.h, cells = lv.cells;
    var segs = [], lit = lv.seeds.map(function () { return false; });
    var litCells = {}, mirrorsHit = {}, seen = {};
    var stack = [];
    lv.emitters.forEach(function (e) { stack.push([e.x, e.y, e.dir[0], e.dir[1], 0]); });
    var guard = 0;
    while (stack.length && guard++ < 4000) {
      var b = stack.pop(), x = b[0], y = b[1], dx = b[2], dy = b[3], bounces = b[4];
      while (guard++ < 4000) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { segs.push([x, y, x + dx * 0.5, y + dy * 0.5]); break; }
        var c = cells[ny * w + nx];
        if (c.t === '#' || c.t === 'E') { segs.push([x, y, x + dx * 0.5, y + dy * 0.5]); break; }
        segs.push([x, y, nx, ny]);
        var key = nx + ',' + ny + ',' + dx + ',' + dy;
        if (seen[key]) break;
        seen[key] = true;
        x = nx; y = ny;
        var ck = x + ',' + y;
        litCells[ck] = Math.max(litCells[ck] || 0, bounces);
        if (c.t === 'S') lit[c.si] = true;
        else if (c.t === 'M') {
          var o = orients ? orients[c.mi] : c.o;
          if (o === -1) return { pending: c.mi };
          var r = reflect(o, dx, dy); dx = r[0]; dy = r[1]; bounces++;
          mirrorsHit[c.mi] = true;
        } else if (c.t === 'X') {
          // split into the two perpendicular directions
          stack.push([x, y, dy, dx, bounces + 1]);
          stack.push([x, y, -dy, -dx, bounces + 1]);
          break;
        }
      }
    }
    return { segs: segs, lit: lit, litCells: litCells, mirrorsHit: mirrorsHit,
             solved: lit.length > 0 && lit.every(Boolean) };
  }

  function currentOrients(lv) { return lv.mirrors.map(function (m) { return m.o; }); }

  /** All solutions as partial assignments (-1 = mirror never touched, any orientation works).
   *  Lazy branching: only mirrors the light actually reaches are decided. */
  function solutions(lv, cap) {
    var out = [], calls = 0;
    function go(assign) {
      if (cap && out.length >= cap) return;
      if (++calls > 20000) return;
      var r = simulate(lv, assign);
      if (r.pending !== undefined) {
        var a0 = assign.slice(), a1 = assign.slice();
        a0[r.pending] = 0; a1[r.pending] = 1;
        go(a0); go(a1);
      } else if (r.solved) out.push(assign);
    }
    go(lv.mirrors.map(function () { return -1; }));
    return out;
  }

  /** Minimum flips from the current state to any solution, and that solution (fully specified). */
  function nearestSolution(lv, orients) {
    orients = orients || currentOrients(lv);
    var sols = solutions(lv), best = null, bestD = Infinity;
    sols.forEach(function (s) {
      var d = 0;
      for (var i = 0; i < s.length; i++) if (s[i] !== -1 && s[i] !== orients[i]) d++;
      if (d < bestD) { bestD = d; best = s; }
    });
    if (!best) return null;
    var full = best.map(function (v, i) { return v === -1 ? orients[i] : v; });
    return { flips: bestD, solution: full, count: sols.length };
  }

  /** Index of a mirror the player should flip next (for hints), or -1. */
  function hint(lv) {
    var o = currentOrients(lv), near = nearestSolution(lv, o);
    if (!near || near.flips === 0) return -1;
    // Prefer a wrong mirror the beam currently touches, so the hint is visible.
    var hit = simulate(lv).mirrorsHit, fallback = -1;
    for (var i = 0; i < o.length; i++) {
      if (o[i] !== near.solution[i]) {
        if (hit[i]) return i;
        if (fallback < 0) fallback = i;
      }
    }
    return fallback;
  }

  /* ---------------- Handcrafted onboarding levels ---------------- */
  var LEVELS = [
    { name: 'First Light', tip: 'Tap the mirror to turn it.', rows: [
      '>../',
      '....',
      '...*'] },
    { name: 'Two Turns', tip: 'Light bends at every mirror.', rows: [
      '>..../',
      '......',
      '......',
      '.*...\\'] },
    { name: 'Stones', tip: 'Stones block the light. Wake both seeds.', rows: [
      'v.....',
      '...#..',
      '/..../',
      '..#...',
      '*....*',
      '/....\\'] },
    { name: 'Crystal', tip: 'Crystals split light in two.', rows: [
      '......',
      '*../..',
      '......',
      '>..x..',
      '......',
      '.\\./.*'] },
    { name: 'Garden Path', tip: 'Every seed must glow at once.', rows: [
      '>.../.',
      '.#....',
      '\\.*./.',
      '...*..',
      '.....#',
      '\\*.\\..'] }
  ];

  function level(i) { var L = LEVELS[i]; return parse(L.rows, { name: L.name, tip: L.tip, index: i }); }

  /* ---------------- Procedural generator (daily / endless) ---------------- */
  function generate(seed, opts) {
    opts = opts || {};
    var size = opts.size || 6, minFlips = opts.minFlips || 3, crystal = opts.crystal !== false;
    var rnd = mulberry32(seed);
    function ri(n) { return Math.floor(rnd() * n); }
    for (var attempt = 0; attempt < 400; attempt++) {
      var g = [];
      for (var y = 0; y < size; y++) { g.push([]); for (var x = 0; x < size; x++) g[y].push('.'); }
      // emitter on an edge, pointing inward
      var side = ri(4), p = 1 + ri(size - 2), ex, ey, ec;
      if (side === 0) { ex = 0; ey = p; ec = '>'; }
      else if (side === 1) { ex = size - 1; ey = p; ec = '<'; }
      else if (side === 2) { ex = p; ey = 0; ec = 'v'; }
      else { ex = p; ey = size - 1; ec = '^'; }
      g[ey][ex] = ec;
      function free() {
        for (var k = 0; k < 50; k++) { var fx = ri(size), fy = ri(size); if (g[fy][fx] === '.') return [fx, fy]; }
        return null;
      }
      var nWalls = 1 + ri(3), nMirrors = Math.round(size * size * 0.24) + ri(2), f, i;
      for (i = 0; i < nWalls; i++) { f = free(); if (f) g[f[1]][f[0]] = '#'; }
      for (i = 0; i < nMirrors; i++) { f = free(); if (f) g[f[1]][f[0]] = rnd() < 0.5 ? '/' : '\\'; }
      if (crystal && rnd() < 0.55) { f = free(); if (f) g[f[1]][f[0]] = 'x'; }
      var lv = parse(g.map(function (r) { return r.join(''); }));
      var sol = currentOrients(lv);
      var sim = simulate(lv, sol);
      var used = Object.keys(sim.mirrorsHit).length;
      if (used < 3) continue;
      // candidate seed cells: empty, lit after >= 2 bounces
      var cands = [];
      Object.keys(sim.litCells).forEach(function (k) {
        var xy = k.split(',').map(Number), b = sim.litCells[k];
        if (g[xy[1]][xy[0]] === '.' && b >= 2) cands.push({ x: xy[0], y: xy[1], b: b });
      });
      if (cands.length < 2) continue;
      cands.sort(function (a, b) { return b.b - a.b || rnd() - 0.5; });
      var nSeeds = Math.min(cands.length, 2 + ri(2)), chosen = [cands[0]];
      for (i = 1; i < cands.length && chosen.length < nSeeds; i++) {
        var c = cands[i], ok = chosen.every(function (s) { return Math.abs(s.x - c.x) + Math.abs(s.y - c.y) >= 3; });
        if (ok) chosen.push(c);
      }
      if (chosen.length < 2) continue;
      chosen.forEach(function (c) { g[c.y][c.x] = '*'; });
      // scramble mirrors
      var rows = g.map(function (r) { return r.join(''); });
      var puzzle = parse(rows);
      for (var tries = 0; tries < 30; tries++) {
        puzzle.mirrors.forEach(function (m) { m.o = ri(2); });
        var near = nearestSolution(puzzle);
        if (near && near.flips >= minFlips) {
          puzzle.seed = seed;
          return puzzle;
        }
      }
    }
    // Extremely unlikely fallback
    return level(LEVELS.length - 1);
  }

  function dateKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function daily(d) {
    var lv = generate(hashString('lumen-' + dateKey(d)), { size: 6, minFlips: 4 });
    lv.name = 'Daily Garden'; lv.tip = 'A new garden grows every day.'; lv.daily = dateKey(d);
    return lv;
  }

  function endless(n) {
    var size = n < 4 ? 6 : 7;
    var lv = generate(hashString('endless-' + n), { size: size, minFlips: Math.min(3 + (n >> 1), 6) });
    lv.name = 'Wild Garden ' + (n + 1); lv.tip = 'Keep the garden glowing.'; lv.endless = n;
    return lv;
  }

  var api = { parse: parse, toRows: toRows, simulate: simulate, solutions: solutions,
    nearestSolution: nearestSolution, hint: hint, LEVELS: LEVELS, level: level,
    generate: generate, daily: daily, endless: endless, dateKey: dateKey,
    currentOrients: currentOrients, hashString: hashString };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Puzzle = api;
})(this);
