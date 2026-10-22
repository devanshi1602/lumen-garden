/* Lumen Garden — game, scene, input (hands / controllers / mouse) and WebXR session handling. */
(function (root) {
  'use strict';
  var M = root.M3, P = root.Puzzle, Renderer = root.Renderer, Sound = root.Sound;

  var CELL = 0.062, BEAM_Y = 0.03, PANEL_W = 0.42, PANEL_H = 0.21, CW = 1024, CH = 512;
  var SEED_COLORS = [[1, 0.42, 0.62], [0.66, 0.52, 1], [1, 0.64, 0.28], [0.38, 0.8, 1]];
  var PETALS = [5, 6, 4, 8]; // shape cue per seed (not colour-only)
  var SAVE_KEY = 'lumen-garden-v1';
  var SKY = [0.075, 0.085, 0.13, 1];

  function load() { try { return JSON.parse(root.localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } }
  function persist(d) { try { root.localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) { /* private mode */ } }
  function smooth(t) { t = M.clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function rnd2(x, y, k) { var s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); }
  function yesterday(key) { var d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() - 1); return P.dateKey(d); }
  function scale3(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

  function Game(canvas) {
    this.canvas = canvas;
    this.r = new Renderer(canvas); this.gl = this.r.gl;
    this.sound = new Sound();
    var saved = load();
    this.progress = saved.progress || { levelsDone: 0, lastDaily: null, streak: 0, garden: 0, endless: 0 };
    this.settings = saved.settings || { sound: true, contrast: false };
    this.sound.enabled = this.settings.sound;
    this.board = { pos: [0, -0.36, -0.46], yaw: 0 };
    this.panelCanvas = document.createElement('canvas'); this.panelCanvas.width = CW; this.panelCanvas.height = CH;
    this.panelCtx = this.panelCanvas.getContext('2d');
    this.panelTex = this.r.texture(this.panelCanvas); this.panelSig = '';
    this.buttons = [];
    this.pointers = {}; this.particles = []; this.time = 0; this.xr = null;
    this.cam = { yaw: 0, pitch: 0.5, dist: 0.66, target: [0, -0.31, -0.55] };
    this.fireflies = []; for (var i = 0; i < 9; i++) this.fireflies.push([Math.random() * 6.28, 0.3 + Math.random() * 0.5, Math.random() * 6.28, Math.random()]);
    this._resume(saved.current);
    this._bindDesktop();
    this._last = performance.now();
    var self = this; this._raf = function (t) { self._desktopFrame(t); };
    requestAnimationFrame(this._raf);
  }

  /* ======================= puzzle flow ======================= */
  Game.prototype._resume = function (cur) {
    try {
      if (cur && cur.mode) {
        if (cur.mode === 'daily' && cur.daily !== P.dateKey()) { this.start('daily', 0); return; }
        this.start(cur.mode, cur.idx);
        if (cur.won) { this.next(); return; }
        if (cur.orients && cur.orients.length === this.lv.mirrors.length) {
          var self = this;
          cur.orients.forEach(function (o, i) { self.lv.mirrors[i].o = o; self.anim[i].a = self.anim[i].target = o ? -Math.PI / 4 : Math.PI / 4; });
          this.taps = cur.taps || 0; this._recompute(true);
        }
        return;
      }
    } catch (e) { /* corrupted save — fall through */ }
    if (this.progress.levelsDone < P.LEVELS.length) this.start('levels', this.progress.levelsDone);
    else if (this.progress.lastDaily !== P.dateKey()) this.start('daily', 0);
    else this.start('endless', this.progress.endless);
  };

  Game.prototype.start = function (mode, idx) {
    idx = idx || 0;
    var lv = mode === 'levels' ? P.level(Math.min(idx, P.LEVELS.length - 1)) : mode === 'daily' ? P.daily() : P.endless(idx);
    this.mode = mode; this.idx = idx; this.lv = lv;
    this.taps = 0; this.hints = 0; this.won = false; this.wonAt = 0; this.hintMirror = -1;
    this.lastAction = this.time; this.autoHinted = false;
    this.anim = lv.mirrors.map(function (m) { var a = m.o ? -Math.PI / 4 : Math.PI / 4; return { a: a, target: a }; });
    this.bloom = lv.seeds.map(function () { return 0; });
    this.prevLit = lv.seeds.map(function () { return false; });
    this._recompute(true);
    this._buildStatic();
    this._save();
  };

  Game.prototype.next = function () {
    if (this.mode === 'levels' && this.idx + 1 < P.LEVELS.length) this.start('levels', this.idx + 1);
    else if (this.mode !== 'daily' && this.progress.lastDaily !== P.dateKey()) this.start('daily', 0);
    else this.start('endless', this.mode === 'endless' ? this.idx + 1 : this.progress.endless);
  };

  Game.prototype.flip = function (mi) {
    if (this.won || mi < 0 || mi >= this.lv.mirrors.length) return;
    this.lv.mirrors[mi].o ^= 1;
    this.anim[mi].target += Math.PI / 2;
    this.taps++; this.lastAction = this.time;
    if (this.hintMirror === mi) this.hintMirror = -1;
    var c = this.lv.mirrors[mi];
    this.sound.turn(this._world(c.x, c.y, BEAM_Y));
    this._recompute(false);
    this._save();
  };

  Game.prototype._recompute = function (silent) {
    var sim = this.sim = P.simulate(this.lv), self = this, n = 0;
    sim.lit.forEach(function (l, i) {
      if (l) n++;
      if (!silent && l !== self.prevLit[i]) {
        var s = self.lv.seeds[i], wp = self._world(s.x, s.y, 0.05);
        if (l) { self.sound.bloom(i, wp); self._burst(wp, SEED_COLORS[i % 4], 8, 0.08); }
        else self.sound.wilt(wp);
      }
    });
    this.prevLit = sim.lit.slice();
    this.sound.setGlow(sim.lit.length ? n / sim.lit.length : 0);
    if (sim.solved && !this.won && !silent) this._win();
  };

  Game.prototype._win = function () {
    this.won = true; this.wonAt = this.time; this.hintMirror = -1;
    var self = this, pr = this.progress;
    setTimeout(function () { self.sound.win(); }, 280);
    this.lv.seeds.forEach(function (s, i) { self._burst(self._world(s.x, s.y, 0.06), SEED_COLORS[i % 4], 26, 0.22); });
    if (this.mode === 'levels') pr.levelsDone = Math.max(pr.levelsDone, this.idx + 1);
    else if (this.mode === 'daily') {
      var k = this.lv.daily;
      if (pr.lastDaily !== k) { pr.streak = pr.lastDaily === yesterday(k) ? pr.streak + 1 : 1; pr.garden++; pr.lastDaily = k; }
      this._buildStatic();
    } else pr.endless = Math.max(pr.endless, this.idx + 1);
    this._save();
  };

  Game.prototype.giveHint = function () {
    if (this.won) return;
    var mi = P.hint(this.lv);
    if (mi >= 0) { this.hintMirror = mi; this.hints++; var c = this.lv.mirrors[mi]; this.sound.hint(this._world(c.x, c.y, BEAM_Y)); }
  };

  Game.prototype._save = function () {
    persist({ progress: this.progress, settings: this.settings,
      current: { mode: this.mode, idx: this.idx, orients: P.currentOrients(this.lv), taps: this.taps, daily: this.lv.daily || null, won: this.won } });
  };

  Game.prototype.button = function (id) {
    this.sound.ui();
    var b = this.board;
    switch (id) {
      case 'hint': this.giveHint(); break;
      case 'reset': this.start(this.mode, this.idx); break;
      case 'next': this.next(); break;
      case 'down': b.pos[1] -= 0.03; this._buildStatic(); break;
      case 'up': b.pos[1] += 0.03; this._buildStatic(); break;
      case 'center': this.needsRecenter = true; if (!this.xr) { this.board = { pos: [0, -0.36, -0.46], yaw: 0 }; this._buildStatic(); } break;
      case 'sound': this.settings.sound = !this.settings.sound; this.sound.setEnabled(this.settings.sound); this._save(); break;
      case 'contrast': this.settings.contrast = !this.settings.contrast; this._buildStatic(); this._save(); break;
    }
  };

  /* ======================= geometry helpers ======================= */
  Game.prototype._cx = function (x) { return (x - (this.lv.w - 1) / 2) * CELL; };
  Game.prototype._cz = function (y) { return (y - (this.lv.h - 1) / 2) * CELL; };
  Game.prototype._boardMats = function () {
    this.boardMat = M.trs(this.board.pos[0], this.board.pos[1], this.board.pos[2], 0, this.board.yaw, 0, 1);
    this.invBoard = M.invert(this.boardMat);
    this.panelLocal = M.trs(0, 0.125, -(this.lv.h * CELL) / 2 - 0.075, -0.38, 0, 0, PANEL_W, PANEL_H, 1);
    this.invPanel = M.invert(this.panelLocal);
  };
  Game.prototype._world = function (x, y, h) { return M.point(this.boardMat, [this._cx(x), h, this._cz(y)]); };
  Game.prototype._bm = function (local) { return M.mul(this.boardMat, local); };
  Game.prototype._item = function (mesh, local, color, em, extra) {
    var it = { mesh: mesh, m: this._bm(local), color: color, em: em };
    if (extra) for (var k in extra) it[k] = extra[k];
    return it;
  };

  /* ======================= static scene ======================= */
  Game.prototype._buildStatic = function () {
    this._boardMats();
    var lv = this.lv, hc = this.settings.contrast, S = [], self = this;
    var bw = lv.w * CELL, bh = lv.h * CELL;
    function add(mesh, l, color, em, extra) { S.push(self._item(mesh, l, color, em, extra)); }
    var room = !this.xr || this.xr.mode !== 'immersive-ar';
    if (room) {
      add('box', M.trs(0, -0.047, 0.04, 0, 0, 0, 1.0, 0.04, 0.62), [0.27, 0.19, 0.15, 1]);
      add('disc', M.trs(0, -0.74, 0.2, 0, 0, 0, 6), [0.13, 0.14, 0.19, 1]);
      add('disc', M.trs(0, -0.739, 0.2, 0, 0, 0, 1.6), [0.17, 0.18, 0.24, 1]);
    }
    // board base + soft shadow
    add('box', M.trs(0, -0.013, 0, 0, 0, 0, bw + 0.036, 0.026, bh + 0.036), hc ? [0.06, 0.06, 0.08, 1] : [0.44, 0.3, 0.2, 1]);
    add('box', M.trs(0, 0.0005, 0, 0, 0, 0, bw + 0.012, 0.002, bh + 0.012), hc ? [0.1, 0.1, 0.13, 1] : [0.33, 0.22, 0.15, 1]);
    lv.cells.forEach(function (c) {
      var x = self._cx(c.x), z = self._cz(c.y), alt = (c.x + c.y) % 2;
      var tile = hc ? (alt ? [0.2, 0.2, 0.25, 1] : [0.16, 0.16, 0.2, 1]) : (alt ? [0.3, 0.45, 0.26, 1] : [0.27, 0.41, 0.24, 1]);
      add('box', M.trs(x, 0.003, z, 0, 0, 0, CELL * 0.93, 0.004, CELL * 0.93), tile);
      if (c.t === '#') {
        var hgt = 0.03 + rnd2(c.x, c.y, 1) * 0.02, rot = rnd2(c.x, c.y, 2) * 0.6;
        add('box', M.trs(x, 0.005 + hgt / 2, z, 0, rot, 0, CELL * 0.78, hgt, CELL * 0.72), hc ? [0.7, 0.7, 0.75, 1] : [0.5, 0.5, 0.53, 1]);
        add('box', M.trs(x + 0.006, 0.005 + hgt + 0.008, z - 0.004, 0, rot + 0.5, 0, CELL * 0.4, 0.016, CELL * 0.38), hc ? [0.8, 0.8, 0.85, 1] : [0.58, 0.57, 0.6, 1]);
      } else if (c.t === 'E') {
        add('cyl', M.trs(x, 0.016, z, 0, 0, 0, 0.04, 0.024, 0.04), [0.62, 0.48, 0.26, 1]);
        add('box', M.trs(x + c.dir[0] * 0.02, 0.034, z + c.dir[1] * 0.02, 0, 0, 0, c.dir[0] ? 0.02 : 0.012, 0.012, c.dir[1] ? 0.02 : 0.012), [0.7, 0.55, 0.3, 1]);
      } else if (c.t === 'M') {
        add('cyl', M.trs(x, 0.009, z, 0, 0, 0, 0.044, 0.008, 0.044), hc ? [0.45, 0.45, 0.5, 1] : [0.55, 0.52, 0.48, 1]);
      } else if (c.t === 'X') {
        add('cyl', M.trs(x, 0.008, z, 0, 0, 0, 0.034, 0.006, 0.034), [0.42, 0.44, 0.5, 1]);
      } else if (c.t === 'S') {
        add('cyl', M.trs(x, 0.01, z, 0, 0, 0, 0.046, 0.012, 0.046), hc ? [0.35, 0.28, 0.22, 1] : [0.36, 0.25, 0.17, 1]);
      }
    });
    // garden shelf: one potted flower per daily garden completed ("reason to come back")
    var pots = Math.min(this.progress.garden, 10);
    for (var k = 0; k < pots; k++) {
      var px = -bw / 2 - 0.05, pz = -bh / 2 + 0.02 + k * (bh - 0.04) / 9, col = SEED_COLORS[k % 4];
      add('cyl', M.trs(px, 0.012, pz, 0, 0, 0, 0.024, 0.024, 0.024), [0.78, 0.42, 0.29, 1]);
      add('cyl', M.trs(px, 0.034, pz, 0, 0, 0, 0.003, 0.024, 0.003), [0.3, 0.6, 0.25, 1]);
      add('sphere', M.trs(px, 0.048, pz, 0, 0, 0, 0.016, 0.009, 0.016), [col[0], col[1], col[2], 1], scale3(col, 0.25));
    }
    this.staticItems = S;
  };

  /* ======================= per-frame scene ======================= */
  Game.prototype._dynamic = function (dt) {
    var r = this.r, lv = this.lv, sim = this.sim, t = this.time, self = this, hc = this.settings.contrast;
    r.clearList();
    this.staticItems.forEach(function (it) { r.add(it); });
    function add(mesh, l, color, em, extra) { return r.add(self._item(mesh, l, color, em, extra)); }
    var hover = this._hovered();

    // emitters
    lv.emitters.forEach(function (e) {
      var x = self._cx(e.x), z = self._cz(e.y), pulse = 0.9 + 0.1 * Math.sin(t * 3);
      add('sphere', M.trs(x, 0.036, z, 0, 0, 0, 0.024), [1, 0.86, 0.55, 1], null, { unlit: 1 });
      add('sphere', M.trs(x, 0.036, z, 0, 0, 0, 0.06 * pulse), [1, 0.7, 0.3, 0.22], null, { add: 1, unlit: 1 });
    });
    // mirrors
    lv.mirrors.forEach(function (m, i) {
      var a = self.anim[i]; a.a += (a.target - a.a) * Math.min(1, dt * 14);
      var x = self._cx(m.x), z = self._cz(m.y), em = [0, 0, 0];
      if (sim.mirrorsHit[i]) em = [0.12, 0.1, 0.05];
      if (hover.mirror === i) em = [0.18, 0.26, 0.34];
      if (self.hintMirror === i) { var p = 0.5 + 0.5 * Math.sin(t * 7); em = [0.55 * p, 0.38 * p, 0.05]; }
      add('box', M.trs(x, 0.033, z, 0, a.a, 0, 0.058, 0.04, 0.006), hc ? [0.95, 0.97, 1, 1] : [0.76, 0.85, 0.94, 1], em);
      add('box', M.trs(x, 0.0545, z, 0, a.a, 0, 0.06, 0.004, 0.009), [0.85, 0.66, 0.3, 1]);
      if (hover.mirror === i || self.hintMirror === i) {
        var col = self.hintMirror === i ? [1, 0.75, 0.2, 0.35 + 0.25 * Math.sin(t * 7)] : [0.5, 0.8, 1, 0.35];
        add('disc', M.trs(x, 0.006, z, 0, 0, 0, CELL * 0.95), col, null, { add: 1, unlit: 1 });
      }
    });
    // crystals
    lv.cells.forEach(function (c) {
      if (c.t !== 'X') return;
      var x = self._cx(c.x), z = self._cz(c.y), lit = sim.litCells[c.x + ',' + c.y] !== undefined;
      add('octa', M.trs(x, 0.034, z, 0, t * 0.8, 0, 0.04, 0.054, 0.04), [0.55, 0.92, 1, 0.78], lit ? [0.25, 0.5, 0.6] : [0.05, 0.1, 0.12]);
    });
    // beam
    var thick = hc ? 0.007 : 0.005, flick = 0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 5.3);
    mergeSegs(sim.segs).forEach(function (s) {
      var x0 = self._cx(s[0]), z0 = self._cz(s[1]), x1 = self._cx(s[2]), z1 = self._cz(s[3]);
      var len = Math.abs(x1 - x0) + Math.abs(z1 - z0) + thick, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, hz = x0 === x1;
      add('box', M.trs(mx, BEAM_Y, mz, 0, 0, 0, hz ? thick : len, thick, hz ? len : thick), [1, 0.94, 0.72, 1], null, { unlit: 1 });
      var g = thick * 3.4;
      add('box', M.trs(mx, BEAM_Y, mz, 0, 0, 0, hz ? g : len, g, hz ? len : g), [1, 0.72, 0.3, 0.26 * flick], null, { add: 1, unlit: 1 });
    });
    // seeds / flowers
    lv.seeds.forEach(function (s, i) {
      var lit = sim.lit[i], b = self.bloom[i];
      b += ((lit ? 1 : 0) - b) * Math.min(1, dt * (lit ? 2.6 : 1.6)); self.bloom[i] = b;
      var e = smooth(b), x = self._cx(s.x), z = self._cz(s.y), col = SEED_COLORS[i % 4];
      var stemH = 0.008 + 0.042 * e, headY = 0.016 + stemH;
      add('cyl', M.trs(x, 0.016 + stemH / 2, z, 0, 0, 0, 0.005, stemH, 0.005), [0.32, 0.62, 0.27, 1]);
      if (e < 0.2) add('sphere', M.trs(x, headY, z, 0, 0, 0, 0.014, 0.018, 0.014), [col[0] * 0.5 + 0.2, col[1] * 0.5 + 0.35, col[2] * 0.5 + 0.15, 1]);
      if (e > 0.05) {
        var n = PETALS[i % 4], spin = t * 0.25;
        for (var k = 0; k < n; k++) {
          var ang = k / n * Math.PI * 2 + spin, rad = 0.013 * e;
          add('sphere', M.trs(x + Math.cos(ang) * rad, headY, z + Math.sin(ang) * rad, 0, -ang, 0.25, 0.026 * e, 0.006, 0.013 * e),
            [col[0], col[1], col[2], 1], scale3(col, 0.3 * e));
        }
        add('sphere', M.trs(x, headY + 0.002, z, 0, 0, 0, 0.012 * Math.max(e, 0.4)), [1, 0.86, 0.32, 1], [0.3 * e, 0.22 * e, 0]);
        add('sphere', M.trs(x, headY, z, 0, 0, 0, 0.07 * e), [col[0], col[1], col[2], 0.16 * e], null, { add: 1, unlit: 1 });
      }
      if (!lit) {
        var pul = 0.5 + 0.5 * Math.sin(t * 2.4 + i);
        add('disc', M.trs(x, 0.0065, z, 0, 0, 0, CELL * (0.7 + 0.15 * pul)), [col[0], col[1], col[2], 0.12 + 0.12 * pul], null, { add: 1, unlit: 1 });
      }
    });
    // fireflies
    var bw = lv.w * CELL;
    this.fireflies.forEach(function (f, i) {
      var ft = t * (0.15 + f[3] * 0.2);
      var x = Math.sin(ft + f[0]) * (bw * 0.55 + 0.05 * f[1]), z = Math.cos(ft * 0.8 + f[2]) * bw * 0.5, y = 0.06 + 0.07 * f[1] + 0.02 * Math.sin(t + i);
      var a = 0.25 + 0.25 * Math.sin(t * (2 + f[3] * 3) + i);
      add('lowSphere', M.trs(x, y, z, 0, 0, 0, 0.004), [1, 0.9, 0.5, 1], null, { unlit: 1 });
      add('lowSphere', M.trs(x, y, z, 0, 0, 0, 0.011), [1, 0.85, 0.4, a * 0.6], null, { add: 1, unlit: 1 });
    });
    // particles (world space)
    this.particles = this.particles.filter(function (p) { p.life -= dt; return p.life > 0; });
    this.particles.forEach(function (p) {
      p.v[1] -= 0.05 * dt; p.p[0] += p.v[0] * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
      var k = p.life / p.max;
      r.add({ mesh: 'lowSphere', m: M.trs(p.p[0], p.p[1], p.p[2], 0, 0, 0, p.s * (0.5 + k)), color: [p.c[0], p.c[1], p.c[2], k * 0.9], add: 1, unlit: 1 });
    });
    // panel
    this._drawPanel(hover);
    r.add({ mesh: 'quad', m: this._bm(this.panelLocal), color: [1, 1, 1, 1], tex: this.panelTex, unlit: 1 });
    // pointers & hands
    this._drawPointers();
  };

  /** Join consecutive collinear beam steps so the glow has no bright seams. */
  function mergeSegs(segs) {
    var out = [];
    segs.forEach(function (s) {
      var q = out[out.length - 1];
      if (q && q[2] === s[0] && q[3] === s[1] && Math.sign(q[2] - q[0]) === Math.sign(s[2] - s[0]) && Math.sign(q[3] - q[1]) === Math.sign(s[3] - s[1])) { q[2] = s[2]; q[3] = s[3]; }
      else out.push(s.slice());
    });
    return out;
  }

  Game.prototype._burst = function (wp, col, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, u = Math.random();
      this.particles.push({ p: wp.slice(), v: [Math.cos(a) * speed * 0.35 * u, speed * (0.3 + Math.random() * 0.7), Math.sin(a) * speed * 0.35 * u],
        life: 0.9 + Math.random() * 0.9, max: 1.8, c: col, s: 0.004 + Math.random() * 0.005 });
    }
  };

  /* ======================= UI panel ======================= */
  Game.prototype._panelModel = function () {
    var lv = this.lv, pr = this.progress, title, stats;
    if (this.mode === 'levels') { title = (this.idx + 1) + ' · ' + lv.name; stats = 'Lesson ' + (this.idx + 1) + ' of ' + P.LEVELS.length; }
    else if (this.mode === 'daily') { title = 'Daily Garden · ' + lv.daily; stats = 'Streak ' + pr.streak + ' day' + (pr.streak === 1 ? '' : 's') + '   ·   Garden: ' + pr.garden + ' flower' + (pr.garden === 1 ? '' : 's'); }
    else { title = lv.name; stats = 'Garden: ' + pr.garden + ' flowers   ·   Daily streak ' + pr.streak; }
    var tip = this.won ? 'Every seed is glowing!  ' + this.taps + ' turn' + (this.taps === 1 ? '' : 's') + (this.hints ? ', ' + this.hints + ' hint' + (this.hints === 1 ? '' : 's') : '') : lv.tip;
    if (this.won && this.mode === 'daily') tip = 'Today’s garden bloomed! Come back tomorrow for a new one.';
    return { title: title, stats: stats, tip: tip };
  };

  Game.prototype._drawPanel = function (hover) {
    var pm = this._panelModel(), s = this.settings;
    var sig = [pm.title, pm.tip, pm.stats, this.won, hover.button, s.sound, s.contrast, this.sim.lit.join()].join('|');
    if (sig === this.panelSig) return;
    this.panelSig = sig;
    var g = this.panelCtx, self = this;
    g.clearRect(0, 0, CW, CH);
    rr(g, 6, 6, CW - 12, CH - 12, 40); g.fillStyle = s.contrast ? 'rgba(0,0,0,0.94)' : 'rgba(14,18,28,0.86)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.14)'; g.stroke();
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#ffffff'; g.font = '700 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; g.fillText(pm.title, 50, 98);
    g.fillStyle = this.won ? '#ffd970' : (s.contrast ? '#ffffff' : '#cfe0ff'); g.font = '500 36px system-ui, sans-serif';
    wrap(g, pm.tip, 50, 156, 900, 42);
    g.fillStyle = s.contrast ? '#e6e6e6' : '#93a4bd'; g.font = '500 28px system-ui, sans-serif'; g.fillText(pm.stats, 50, 250);
    // seed indicators
    this.sim.lit.forEach(function (l, i) {
      var c = SEED_COLORS[i % 4], x = CW - 60 - (self.sim.lit.length - 1 - i) * 52, col = 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
      g.beginPath(); g.arc(x, 82, 18, 0, Math.PI * 2); g.lineWidth = 5; g.strokeStyle = col; g.stroke();
      if (l) { g.fillStyle = col; g.fill(); }
    });
    // buttons
    var B = this.buttons = [];
    if (this.won) {
      B.push({ id: 'next', label: 'Next garden  ▶', x: 50, y: 290, w: 560, h: 130, primary: true });
      B.push({ id: 'reset', label: 'Replay', x: 640, y: 290, w: 334, h: 130 });
    } else {
      var defs = [['hint', '?', 'Hint'], ['reset', '↺', 'Reset'], ['down', '▼', 'Lower'], ['up', '▲', 'Raise'],
        ['center', '◎', 'Center'], ['sound', '♪', s.sound ? 'Sound' : 'Muted'], ['contrast', '◐', s.contrast ? 'Contrast+' : 'Contrast']];
      var bw = 122, gap = 11, x0 = (CW - (defs.length * bw + (defs.length - 1) * gap)) / 2;
      defs.forEach(function (d, i) { B.push({ id: d[0], glyph: d[1], label: d[2], x: x0 + i * (bw + gap), y: 290, w: bw, h: 130 }); });
    }
    B.forEach(function (b) {
      var hov = hover.button === b.id;
      rr(g, b.x, b.y, b.w, b.h, 24);
      g.fillStyle = b.primary ? (hov ? '#ffe08a' : '#ffcc4d') : hov ? 'rgba(130,180,255,0.42)' : 'rgba(255,255,255,0.1)'; g.fill();
      if (hov) { g.lineWidth = 4; g.strokeStyle = '#bfe0ff'; g.stroke(); }
      g.textAlign = 'center'; g.fillStyle = b.primary ? '#2a1d00' : '#ffffff';
      if (b.glyph) {
        g.font = '600 48px system-ui, sans-serif'; g.fillText(b.glyph, b.x + b.w / 2, b.y + 64);
        g.font = '600 24px system-ui, sans-serif'; g.fillText(b.label, b.x + b.w / 2, b.y + 108);
      } else { g.font = '700 42px system-ui, sans-serif'; g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 15); }
      g.textAlign = 'left';
    });
    g.fillStyle = s.contrast ? '#cccccc' : '#6f7f96'; g.font = '500 24px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('Touch a mirror, or point and pinch, to turn it', CW / 2, 474); g.textAlign = 'left';
    this.r.updateTexture(this.panelTex, this.panelCanvas);
  };
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function wrap(g, text, x, y, maxW, lh) {
    var words = text.split(' '), line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); line = words[i]; y += lh; } else line = test;
    }
    g.fillText(line, x, y);
  }
  Game.prototype._buttonAt = function (u, v) {
    var px = u * CW, py = (1 - v) * CH;
    for (var i = 0; i < this.buttons.length; i++) { var b = this.buttons[i]; if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b; }
    return null;
  };

  /* ======================= input ======================= */
  /** Raycast in world space against mirrors, the panel and the board. */
  Game.prototype._raycast = function (ow, dw) {
    var o = M.point(this.invBoard, ow), d = M.dir(this.invBoard, dw), best = null, self = this, h = CELL * 0.47;
    function take(hit) { if (hit.t > 0 && (!best || hit.t < best.t)) best = hit; }
    // 1) the visible mirror panels themselves (precise), 2) otherwise the whole tile under the ray
    var mirrorHit = null;
    this.lv.mirrors.forEach(function (m, i) {
      var x = self._cx(m.x), z = self._cz(m.y), a = self.anim[i].a, ca = Math.cos(a), sa = Math.sin(a);
      var ox = o[0] - x, oz = o[2] - z, lo = [ca * ox - sa * oz, o[1] - 0.033, sa * ox + ca * oz], ld = [ca * d[0] - sa * d[2], d[1], sa * d[0] + ca * d[2]];
      var t = M.rayBox(lo, ld, [-0.031, -0.024, -0.009], [0.031, 0.026, 0.009]);
      if (t > 0 && (!mirrorHit || t < mirrorHit.t)) mirrorHit = { t: t, type: 'mirror', mi: i };
    });
    if (!mirrorHit) [0.03, 0.0].forEach(function (ph) {
      if (mirrorHit || Math.abs(d[1]) < 1e-6) return;
      var t = (ph - o[1]) / d[1]; if (t <= 0) return;
      var gx = Math.round((o[0] + d[0] * t) / CELL + (self.lv.w - 1) / 2), gy = Math.round((o[2] + d[2] * t) / CELL + (self.lv.h - 1) / 2);
      if (gx < 0 || gy < 0 || gx >= self.lv.w || gy >= self.lv.h) return;
      var c = self.lv.cells[gy * self.lv.w + gx];
      if (c.t === 'M') mirrorHit = { t: t, type: 'mirror', mi: c.mi };
    });
    if (mirrorHit) take(mirrorHit);
    var po = M.point(this.invPanel, o), pd = M.dir(this.invPanel, d);
    if (pd[2] < 0) {
      var t = -po[2] / pd[2], hx = po[0] + pd[0] * t, hy = po[1] + pd[1] * t;
      if (t > 0 && Math.abs(hx) <= 0.5 && Math.abs(hy) <= 0.5) take({ t: t, type: 'panel', button: this._buttonAt(hx + 0.5, hy + 0.5) });
    }
    var bw = this.lv.w * CELL / 2 + 0.02, bh = this.lv.h * CELL / 2 + 0.02, tb = M.rayBox(o, d, [-bw, -0.03, -bh], [bw, 0.006, bh]);
    if (tb > 0) take({ t: tb, type: 'board' });
    if (best) best.point = [ow[0] + dw[0] * best.t, ow[1] + dw[1] * best.t, ow[2] + dw[2] * best.t];
    return best;
  };

  Game.prototype._hovered = function () {
    var out = { mirror: -1, button: null };
    for (var k in this.pointers) {
      var p = this.pointers[k];
      if (p.pokeHover !== undefined && p.pokeHover >= 0) out.mirror = p.pokeHover;
      if (p.pokeButton) out.button = p.pokeButton;
      if (!p.hit || p.suppressRay) continue;
      if (p.hit.type === 'mirror' && !this.won) out.mirror = p.hit.mi;
      if (p.hit.type === 'panel' && p.hit.button) out.button = p.hit.button.id;
    }
    return out;
  };

  Game.prototype._activate = function (hit) {
    if (!hit) return;
    this.sound.unlock();
    if (hit.type === 'mirror') this.flip(hit.mi);
    else if (hit.type === 'panel' && hit.button) this.button(hit.button.id);
  };

  /** Fingertip "poke" interaction: touch mirrors and press panel buttons directly. */
  Game.prototype._poke = function (p) {
    p.pokeHover = -1; p.pokeButton = null; p.suppressRay = false;
    if (!p.tip) return;
    var lt = M.point(this.invBoard, p.tip), self = this, inside = -1, near = -1, h = CELL * 0.46;
    this.lv.mirrors.forEach(function (m, i) {
      var dx = Math.abs(lt[0] - self._cx(m.x)), dz = Math.abs(lt[2] - self._cz(m.y));
      if (dx < h && dz < h) { if (lt[1] > -0.01 && lt[1] < 0.058) inside = i; else if (lt[1] < 0.13) near = i; }
    });
    if (inside >= 0 && inside !== p.pokeMirror && this.time - (p.lastPoke === undefined ? -9 : p.lastPoke) > 0.35 && !this.won) { this.flip(inside); p.lastPoke = this.time; }
    p.pokeMirror = inside;
    p.pokeHover = inside >= 0 ? inside : near;
    var bw = this.lv.w * CELL / 2 + 0.06, bh = this.lv.h * CELL / 2 + 0.06;
    if (lt[1] < 0.14 && Math.abs(lt[0]) < bw && Math.abs(lt[2]) < bh) p.suppressRay = true;
    var pl = M.point(this.invPanel, lt);
    if (Math.abs(pl[0]) <= 0.5 && Math.abs(pl[1]) <= 0.5 && pl[2] > -0.03 && pl[2] < 0.09) {
      p.suppressRay = true;
      var b = this._buttonAt(pl[0] + 0.5, pl[1] + 0.5);
      p.pokeButton = b ? b.id : null;
      if (pl[2] < 0.006 && p.panelArmed && b) { p.panelArmed = false; this.button(b.id); }
    }
    if (pl[2] > 0.02) p.panelArmed = true;
  };

  Game.prototype._drawPointers = function () {
    var r = this.r, ar = this.xr && this.xr.mode === 'immersive-ar';
    for (var k in this.pointers) {
      var p = this.pointers[k];
      if (p.kind === 'mouse') continue;
      if (p.joints && !ar) p.joints.forEach(function (j) {
        r.add({ mesh: 'lowSphere', m: M.trs(j[0], j[1], j[2], 0, 0, 0, Math.max(j[3] * 2, 0.008)), color: [0.86, 0.82, 0.8, 1] });
      });
      if (p.tip) {
        r.add({ mesh: 'lowSphere', m: M.trs(p.tip[0], p.tip[1], p.tip[2], 0, 0, 0, 0.012), color: [0.6, 0.9, 1, 0.55], add: 1, unlit: 1 });
      }
      if (p.o && !p.suppressRay) {
        var len = p.hit ? p.hit.t : 0.12, end = [p.o[0] + p.d[0] * len, p.o[1] + p.d[1] * len, p.o[2] + p.d[2] * len];
        r.add({ mesh: 'box', m: segMatrix(p.o, end, 0.0025), color: [0.7, 0.9, 1, p.hit ? 0.5 : 0.18], add: 1, unlit: 1 });
        if (p.hit) r.add({ mesh: 'lowSphere', m: M.trs(end[0], end[1], end[2], 0, 0, 0, 0.012), color: [0.85, 0.95, 1, 0.9], add: 1, unlit: 1 });
      }
    }
  };
  function segMatrix(a, b, th) {
    var d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]) || 1e-4, z = [d[0] / len, d[1] / len, d[2] / len];
    var up = Math.abs(z[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    var x = M.norm([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
    var y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return new Float32Array([x[0] * th, x[1] * th, x[2] * th, 0, y[0] * th, y[1] * th, y[2] * th, 0, z[0] * len, z[1] * len, z[2] * len, 0,
      (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1]);
  }

  /* ======================= shared update ======================= */
  Game.prototype._update = function (dt) {
    this.time += dt;
    for (var k in this.pointers) {
      var p = this.pointers[k];
      this._poke(p);
      p.hit = p.o ? this._raycast(p.o, p.d) : null;
    }
    // gentle auto-hint during lessons if the player seems stuck
    if (this.mode === 'levels' && !this.won && !this.autoHinted && this.hintMirror < 0) {
      var wait = this.idx === 0 ? 3.5 : 12;
      if (this.time - this.lastAction > wait) { this.autoHinted = true; this.hintMirror = P.hint(this.lv); }
    }
    this._dynamic(dt);
  };

  /* ======================= desktop / flat mode ======================= */
  Game.prototype._bindDesktop = function () {
    var self = this, c = this.canvas, down = null;
    function ray(e) {
      var rect = c.getBoundingClientRect(), nx = (e.clientX - rect.left) / rect.width * 2 - 1, ny = 1 - (e.clientY - rect.top) / rect.height * 2;
      var inv = M.invert(M.mul(self.proj, self.view));
      var a = M.point(inv, [nx, ny, -1]), b = M.point(inv, [nx, ny, 1]);
      var pa = projW(inv, [nx, ny, -1]), pb = projW(inv, [nx, ny, 1]);
      return { o: pa, d: M.norm([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]) };
    }
    c.addEventListener('pointermove', function (e) {
      if (self.xr || !self.view) return;
      if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5)) {
        down.drag = true;
        self.cam.yaw = M.clamp(down.yaw - (e.clientX - down.x) * 0.005, -1.2, 1.2);
        self.cam.pitch = M.clamp(down.pitch + (e.clientY - down.y) * 0.005, 0.1, 1.35);
      }
      var rr = ray(e); self.pointers.mouse = { kind: 'mouse', o: rr.o, d: rr.d };
    });
    c.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, yaw: self.cam.yaw, pitch: self.cam.pitch }; });
    c.addEventListener('pointerup', function (e) {
      if (self.xr || !self.view) return;
      var wasDrag = down && down.drag; down = null;
      if (wasDrag) return;
      var rr = ray(e); self._activate(self._raycast(rr.o, rr.d));
    });
    c.addEventListener('pointerleave', function () { delete self.pointers.mouse; down = null; });
    c.addEventListener('wheel', function (e) { e.preventDefault(); self.cam.dist = M.clamp(self.cam.dist + e.deltaY * 0.0006, 0.35, 1.3); }, { passive: false });
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.sound.suspend(); else self.sound.resume(); });
  };
  function projW(inv, p) {
    var x = p[0], y = p[1], z = p[2];
    var w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
    var q = M.point(inv, p); return [q[0] / w, q[1] / w, q[2] / w];
  }

  Game.prototype._desktopFrame = function (now) {
    if (this.xr) return;
    requestAnimationFrame(this._raf);
    var dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
    var gl = this.gl, c = this.canvas, dpr = Math.min(root.devicePixelRatio || 1, 2);
    var w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var cam = this.cam, tg = cam.target, aspect = w / Math.max(h, 1);
    var dist = cam.dist * Math.max(1, 0.75 / aspect); // portrait phones: pull back so the whole board fits
    var eye = [tg[0] + Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist, tg[1] + Math.sin(cam.pitch) * dist, tg[2] + Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist];
    this.view = M.lookAt(eye, tg, [0, 1, 0]);
    this.proj = M.perspective(aspect < 1 ? 1.1 : 0.85, aspect, 0.01, 50);
    this.sound.listener(eye, M.norm([tg[0] - eye[0], tg[1] - eye[1], tg[2] - eye[2]]), [0, 1, 0]);
    this._update(dt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h); gl.clearColor(SKY[0], SKY[1], SKY[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.r.renderView(this.view, this.proj, eye);
  };

  /* ======================= WebXR ======================= */
  Game.prototype.enterXR = function (mode) {
    var self = this, gl = this.gl;
    this.sound.unlock();
    var opts = { optionalFeatures: ['hand-tracking', 'local-floor'] };
    return navigator.xr.requestSession(mode, opts).then(function (session) {
      return Promise.resolve(gl.makeXRCompatible ? gl.makeXRCompatible() : null).then(function () {
        session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl, { antialias: true, alpha: true }) });
        return session.requestReferenceSpace('local');
      }).then(function (ref) {
        self.xr = { session: session, ref: ref, mode: mode };
        self.pointers = {}; self.needsRecenter = true; self._buildStatic();
        if (ref.addEventListener) ref.addEventListener('reset', function () { self.needsRecenter = true; });
        session.addEventListener('select', function (e) {
          var p = self.pointers[srcKey(e.inputSource)];
          if (p && !p.suppressRay) self._activate(p.hit);
        });
        session.addEventListener('visibilitychange', function () {
          if (session.visibilityState === 'visible') self.sound.resume(); else self.sound.suspend();
        });
        session.addEventListener('end', function () {
          self.xr = null; self.pointers = {}; self._buildStatic(); self._last = performance.now();
          requestAnimationFrame(self._raf);
          if (self.onExit) self.onExit();
        });
        self._lastXR = null;
        session.requestAnimationFrame(function f(t, frame) { session.requestAnimationFrame(f); self._xrFrame(t, frame); });
      });
    });
  };

  function srcKey(src) { return (src.handedness || 'none') + (src.hand ? '-hand' : '-ctrl'); }

  Game.prototype._recenter = function (tr) {
    var m = tr.matrix, fx = -m[8], fz = -m[10], yaw = Math.atan2(-fx, -fz);
    this.board.yaw = yaw;
    this.board.pos = [m[12] - Math.sin(yaw) * 0.46, m[13] - 0.36, m[14] - Math.cos(yaw) * 0.46];
    this.needsRecenter = false; this._buildStatic();
  };

  Game.prototype._xrFrame = function (t, frame) {
    var xr = this.xr; if (!xr) return;
    var dt = this._lastXR == null ? 0.016 : Math.min(0.05, (t - this._lastXR) / 1000); this._lastXR = t;
    var pose = frame.getViewerPose(xr.ref); if (!pose) return;
    if (this.needsRecenter) this._recenter(pose.transform);
    var hm = pose.transform.matrix;
    this.sound.listener([hm[12], hm[13], hm[14]], [-hm[8], -hm[9], -hm[10]], [hm[4], hm[5], hm[6]]);
    // input sources
    var seen = {}, self = this;
    for (var i = 0; i < xr.session.inputSources.length; i++) {
      var src = xr.session.inputSources[i], key = srcKey(src); seen[key] = true;
      var p = this.pointers[key] || (this.pointers[key] = { kind: src.hand ? 'hand' : 'ctrl' });
      p.o = null; p.tip = null; p.joints = null;
      var rp = src.targetRaySpace && frame.getPose(src.targetRaySpace, xr.ref);
      if (rp) { var m = rp.transform.matrix; p.o = [m[12], m[13], m[14]]; p.d = M.norm([-m[8], -m[9], -m[10]]); }
      if (src.hand && frame.getJointPose) {
        var tipSpace = src.hand.get('index-finger-tip'), tp = tipSpace && frame.getJointPose(tipSpace, xr.ref);
        if (tp) p.tip = [tp.transform.position.x, tp.transform.position.y, tp.transform.position.z];
        if (xr.mode !== 'immersive-ar') {
          p.joints = [];
          src.hand.forEach(function (space) {
            var jp = frame.getJointPose(space, xr.ref);
            if (jp) p.joints.push([jp.transform.position.x, jp.transform.position.y, jp.transform.position.z, jp.radius || 0.005]);
          });
        }
      } else if (src.gripSpace && !src.hand) {
        var gp = frame.getPose(src.gripSpace, xr.ref);
        if (gp) { var g = gp.transform.position; p.joints = [[g.x, g.y, g.z, 0.012]]; }
      }
    }
    for (var k in this.pointers) if (!seen[k]) delete this.pointers[k];
    this._update(dt);
    var gl = this.gl, layer = xr.session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    var ar = xr.mode === 'immersive-ar';
    gl.clearColor(ar ? 0 : SKY[0], ar ? 0 : SKY[1], ar ? 0 : SKY[2], ar ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    pose.views.forEach(function (view) {
      var vp = layer.getViewport(view), pp = view.transform.position;
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      self.r.renderView(view.transform.inverse.matrix, view.projectionMatrix, [pp.x, pp.y, pp.z]);
    });
  };

  root.Game = Game;
})(this);
