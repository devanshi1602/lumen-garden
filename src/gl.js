/* Tiny dependency-free WebGL renderer: lit meshes, emissive glow, additive blending, canvas textures. */
(function (root) {
  'use strict';
  var M = root.M3;

  var VS = [
    'attribute vec3 aPos; attribute vec3 aNormal; attribute vec2 aUV;',
    'uniform mat4 uModel; uniform mat4 uView; uniform mat4 uProj; uniform mat3 uNormal;',
    'varying vec3 vN; varying vec3 vW; varying vec2 vUV;',
    'void main(){ vec4 w = uModel * vec4(aPos,1.0); vW = w.xyz; vN = normalize(uNormal * aNormal); vUV = aUV;',
    '  gl_Position = uProj * uView * w; }'].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vW; varying vec2 vUV;',
    'uniform vec4 uColor; uniform vec3 uEmissive; uniform vec3 uEye; uniform float uUnlit; uniform float uUseTex;',
    'uniform sampler2D uTex;',
    'void main(){',
    '  vec4 base = uColor;',
    '  if (uUseTex > 0.5) { vec4 t = texture2D(uTex, vUV); base = vec4(t.rgb * uColor.rgb, t.a * uColor.a); }',
    '  if (uUnlit > 0.5) { gl_FragColor = vec4(base.rgb + uEmissive, base.a); return; }',
    '  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(uEye - vW);',
    '  vec3 L = normalize(vec3(0.35, 1.0, 0.45));',
    '  float hemi = 0.5 + 0.5 * N.y;',
    '  vec3 amb = mix(vec3(0.30, 0.27, 0.36), vec3(0.95, 0.93, 0.88), hemi);',
    '  float diff = max(dot(N, L), 0.0);',
    '  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 32.0) * 0.25;',
    '  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.18;',
    '  vec3 c = base.rgb * (amb * 0.55 + diff * vec3(1.0, 0.96, 0.88) * 0.6) + spec + rim + uEmissive;',
    '  gl_FragColor = vec4(c, base.a);',
    '}'].join('\n');

  function Renderer(canvas) {
    var opts = { antialias: true, alpha: true, xrCompatible: true, premultipliedAlpha: false };
    var gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl; this.canvas = canvas;
    this.prog = this._program(VS, FS);
    var p = this.prog;
    this.loc = {
      aPos: gl.getAttribLocation(p, 'aPos'), aNormal: gl.getAttribLocation(p, 'aNormal'), aUV: gl.getAttribLocation(p, 'aUV'),
      uModel: gl.getUniformLocation(p, 'uModel'), uView: gl.getUniformLocation(p, 'uView'), uProj: gl.getUniformLocation(p, 'uProj'),
      uNormal: gl.getUniformLocation(p, 'uNormal'), uColor: gl.getUniformLocation(p, 'uColor'), uEmissive: gl.getUniformLocation(p, 'uEmissive'),
      uEye: gl.getUniformLocation(p, 'uEye'), uUnlit: gl.getUniformLocation(p, 'uUnlit'), uUseTex: gl.getUniformLocation(p, 'uUseTex'),
      uTex: gl.getUniformLocation(p, 'uTex')
    };
    this.meshes = {
      box: this._mesh(boxGeo()), cyl: this._mesh(cylGeo(20)), sphere: this._mesh(sphereGeo(16, 12)),
      lowSphere: this._mesh(sphereGeo(8, 6)), octa: this._mesh(octaGeo()), quad: this._mesh(quadGeo()),
      disc: this._mesh(discGeo(40))
    };
    this.list = [];
  }

  Renderer.prototype._program = function (vs, fs) {
    var gl = this.gl;
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };

  Renderer.prototype._mesh = function (g) {
    var gl = this.gl, data = [];
    for (var i = 0; i < g.pos.length / 3; i++) {
      data.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2], g.uv[i * 2], g.uv[i * 2 + 1]);
    }
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.idx), gl.STATIC_DRAW);
    return { vb: vb, ib: ib, n: g.idx.length };
  };

  Renderer.prototype.texture = function (canvas) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.updateTexture(t, canvas); return t;
  };
  Renderer.prototype.updateTexture = function (t, canvas) {
    var gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  };

  /** Queue a draw. item: {mesh, m (model matrix), color [r,g,b,a], em [r,g,b], unlit, add (additive), tex, nm (cached normal matrix)} */
  Renderer.prototype.add = function (item) { this.list.push(item); return item; };
  Renderer.prototype.clearList = function () { this.list.length = 0; };

  Renderer.prototype.renderView = function (view, proj, eye) {
    var gl = this.gl, L = this.loc;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(L.uView, false, view); gl.uniformMatrix4fv(L.uProj, false, proj);
    gl.uniform3fv(L.uEye, eye);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    var opaque = [], trans = [], add = [];
    for (var i = 0; i < this.list.length; i++) {
      var it = this.list[i];
      if (it.add) add.push(it); else if ((it.color && it.color[3] < 1) || it.tex) trans.push(it); else opaque.push(it);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
    this._draw(opaque);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    this._draw(trans);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this._draw(add);
    gl.depthMask(true); gl.disable(gl.BLEND);
  };

  var NO_EM = [0, 0, 0];
  Renderer.prototype._draw = function (items) {
    var gl = this.gl, L = this.loc, cur = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], mesh = this.meshes[it.mesh];
      if (mesh !== cur) {
        cur = mesh;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
        gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 32, 0);
        if (L.aNormal >= 0) { gl.enableVertexAttribArray(L.aNormal); gl.vertexAttribPointer(L.aNormal, 3, gl.FLOAT, false, 32, 12); }
        if (L.aUV >= 0) { gl.enableVertexAttribArray(L.aUV); gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, 32, 24); }
      }
      if (!it.nm) it.nm = M.normalMat(it.m);
      gl.uniformMatrix4fv(L.uModel, false, it.m);
      gl.uniformMatrix3fv(L.uNormal, false, it.nm);
      gl.uniform4fv(L.uColor, it.color || [1, 1, 1, 1]);
      gl.uniform3fv(L.uEmissive, it.em || NO_EM);
      gl.uniform1f(L.uUnlit, it.unlit ? 1 : 0);
      if (it.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, it.tex); gl.uniform1i(L.uTex, 0); gl.uniform1f(L.uUseTex, 1); }
      else gl.uniform1f(L.uUseTex, 0);
      gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
    }
  };

  /* ---------- geometry (all unit-sized, centred at origin) ---------- */
  function boxGeo() {
    var pos = [], nrm = [], uv = [], idx = [];
    var faces = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    faces.forEach(function (n) {
      var u = n[1] !== 0 ? [1, 0, 0] : [-n[2], 0, n[0]];
      var v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      var b = pos.length / 3;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
        for (var k = 0; k < 3; k++) pos.push(0.5 * (n[k] + c[0] * u[k] + c[1] * v[k]));
        nrm.push(n[0], n[1], n[2]); uv.push((c[0] + 1) / 2, (c[1] + 1) / 2);
      });
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    return { pos: pos, nrm: nrm, uv: uv, idx: idx };
  }
  function cylGeo(seg) {
    var pos = [], nrm = [], uv = [], idx = [], i, a, b;
    for (i = 0; i <= seg; i++) {
      a = i / seg * Math.PI * 2; var c = Math.cos(a), s = Math.sin(a);
      pos.push(c * 0.5, -0.5, s * 0.5, c * 0.5, 0.5, s * 0.5); nrm.push(c, 0, s, c, 0, s); uv.push(i / seg, 0, i / seg, 1);
    }
    for (i = 0; i < seg; i++) { b = i * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    [0.5, -0.5].forEach(function (y) {
      var centre = pos.length / 3; pos.push(0, y, 0); nrm.push(0, Math.sign(y), 0); uv.push(0.5, 0.5);
      for (i = 0; i <= seg; i++) { a = i / seg * Math.PI * 2; pos.push(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5); nrm.push(0, Math.sign(y), 0); uv.push(0, 0); }
      for (i = 0; i < seg; i++) { if (y > 0) idx.push(centre, centre + i + 2, centre + i + 1); else idx.push(centre, centre + i + 1, centre + i + 2); }
    });
    return { pos: pos, nrm: nrm, uv: uv, idx: idx };
  }
  function sphereGeo(seg, rings) {
    var pos = [], nrm = [], uv = [], idx = [];
    for (var r = 0; r <= rings; r++) {
      var phi = r / rings * Math.PI;
      for (var s = 0; s <= seg; s++) {
        var th = s / seg * Math.PI * 2, x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
        pos.push(x * 0.5, y * 0.5, z * 0.5); nrm.push(x, y, z); uv.push(s / seg, r / rings);
      }
    }
    for (r = 0; r < rings; r++) for (s = 0; s < seg; s++) {
      var a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    return { pos: pos, nrm: nrm, uv: uv, idx: idx };
  }
  function octaGeo() {
    var v = [[0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5], [0, 0, -0.5]];
    var f = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    var pos = [], nrm = [], uv = [], idx = [];
    f.forEach(function (t) {
      var a = v[t[0]], b = v[t[1]], c = v[t[2]];
      var n = M.norm([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]), base = pos.length / 3;
      [a, b, c].forEach(function (p) { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); uv.push(0, 0); });
      idx.push(base, base + 1, base + 2);
    });
    return { pos: pos, nrm: nrm, uv: uv, idx: idx };
  }
  function quadGeo() {
    return { pos: [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], nrm: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
             uv: [0, 0, 1, 0, 1, 1, 0, 1], idx: [0, 1, 2, 0, 2, 3] };
  }
  function discGeo(seg) {
    var pos = [0, 0, 0], nrm = [0, 1, 0], uv = [0.5, 0.5], idx = [];
    for (var i = 0; i <= seg; i++) { var a = i / seg * Math.PI * 2; pos.push(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5); nrm.push(0, 1, 0); uv.push(0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2); }
    for (i = 0; i < seg; i++) idx.push(0, i + 2, i + 1);
    return { pos: pos, nrm: nrm, uv: uv, idx: idx };
  }

  root.Renderer = Renderer;
})(this);
