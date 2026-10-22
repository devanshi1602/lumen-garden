/* Procedural spatial audio: every sound is synthesised, no asset files. */
(function (root) {
  'use strict';
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

  function Sound() { this.ctx = null; this.enabled = true; this.ambLevel = 0; }

  Sound.prototype.unlock = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    var ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 0.9 : 0;
    var comp = ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(ctx.destination);
    // simple feedback-delay "reverb" for a soft garden space
    this.wet = ctx.createGain(); this.wet.gain.value = 0.22;
    var d1 = ctx.createDelay(); d1.delayTime.value = 0.13; var fb = ctx.createGain(); fb.gain.value = 0.38;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.wet.connect(d1); d1.connect(lp); lp.connect(fb); fb.connect(d1); lp.connect(this.master);
    // ambient pad that brightens as more seeds glow
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 400;
    this.padFilter.connect(this.padGain); this.padGain.connect(this.master); this.padGain.connect(this.wet);
    var self = this;
    [130.81, 196.0, 261.63, 329.63].forEach(function (f, i) {
      var o = ctx.createOscillator(); o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f; o.detune.value = (i % 2 ? 6 : -6);
      var g = ctx.createGain(); g.gain.value = i < 2 ? 0.16 : 0.05;
      o.connect(g); g.connect(self.padFilter); o.start();
    });
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; var lg = ctx.createGain(); lg.gain.value = 120;
    lfo.connect(lg); lg.connect(this.padFilter.frequency); lfo.start();
    this.padGain.gain.setTargetAtTime(0.10, ctx.currentTime, 1.5);
  };

  Sound.prototype.setEnabled = function (on) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  };
  Sound.prototype.suspend = function () { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); };
  Sound.prototype.resume = function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };

  /** fraction 0..1 of seeds currently glowing */
  Sound.prototype.setGlow = function (f) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    this.padFilter.frequency.setTargetAtTime(380 + f * 1600, t, 0.6);
    this.padGain.gain.setTargetAtTime(0.09 + f * 0.08, t, 0.6);
  };

  Sound.prototype.listener = function (pos, fwd, up) {
    if (!this.ctx) return;
    var L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos[0], t); L.positionY.setValueAtTime(pos[1], t); L.positionZ.setValueAtTime(pos[2], t);
      L.forwardX.setValueAtTime(fwd[0], t); L.forwardY.setValueAtTime(fwd[1], t); L.forwardZ.setValueAtTime(fwd[2], t);
      L.upX.setValueAtTime(up[0], t); L.upY.setValueAtTime(up[1], t); L.upZ.setValueAtTime(up[2], t);
    } else if (L.setPosition) { L.setPosition(pos[0], pos[1], pos[2]); L.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]); }
  };

  Sound.prototype._out = function (pos) {
    var ctx = this.ctx, g = ctx.createGain();
    if (pos) {
      var p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 0.4; p.rolloffFactor = 0.6;
      if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
      g.connect(p); p.connect(this.master); p.connect(this.wet);
    } else { g.connect(this.master); g.connect(this.wet); }
    return g;
  };

  Sound.prototype._tone = function (freq, type, at, dur, vol, pos) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = this._out(pos);
    o.type = type; o.frequency.value = freq; o.connect(g);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.start(at); o.stop(at + dur + 0.05);
  };

  Sound.prototype._bell = function (semi, at, vol, pos, dur) {
    var f = 523.25 * Math.pow(2, semi / 12);
    this._tone(f, 'sine', at, dur || 1.4, vol, pos);
    this._tone(f * 2.01, 'sine', at, (dur || 1.4) * 0.5, vol * 0.35, pos);
    this._tone(f * 3.98, 'triangle', at, 0.25, vol * 0.08, pos);
  };

  /** Mirror turned: wooden click + glassy tick */
  Sound.prototype.turn = function (pos) {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime, len = Math.floor(ctx.sampleRate * 0.04);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3;
    var g = this._out(pos); g.gain.value = 0.7; src.connect(bp); bp.connect(g); src.start(t);
    this._tone(1760, 'sine', t + 0.01, 0.12, 0.08, pos);
  };

  Sound.prototype.bloom = function (idx, pos) {
    if (!this.ctx || !this.enabled) return;
    var t = this.ctx.currentTime, s = PENTA[(idx * 2 + 2) % PENTA.length];
    this._bell(s, t, 0.22, pos); this._bell(s + 7, t + 0.09, 0.12, pos);
  };
  Sound.prototype.wilt = function (pos) {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = this._out(pos);
    o.type = 'sine'; o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.3);
    o.connect(g); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); o.start(t); o.stop(t + 0.4);
  };
  Sound.prototype.win = function () {
    if (!this.ctx || !this.enabled) return;
    var t = this.ctx.currentTime, self = this;
    [0, 4, 7, 12, 16, 19, 24].forEach(function (s, i) { self._bell(s - 5, t + i * 0.085, 0.16, null, 2.2); });
    [0, 7, 12].forEach(function (s) { self._tone(261.63 * Math.pow(2, s / 12), 'triangle', t + 0.6, 2.5, 0.05); });
  };
  Sound.prototype.ui = function () {
    if (!this.ctx || !this.enabled) return;
    var t = this.ctx.currentTime; this._tone(880, 'sine', t, 0.08, 0.08); this._tone(1320, 'sine', t + 0.03, 0.08, 0.05);
  };
  Sound.prototype.hint = function (pos) {
    if (!this.ctx || !this.enabled) return;
    var t = this.ctx.currentTime; this._bell(9, t, 0.1, pos, 0.6); this._bell(9, t + 0.18, 0.07, pos, 0.6);
  };

  root.Sound = Sound;
})(this);
