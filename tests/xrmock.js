// Minimal fake WebXR runtime for automated testing of the XR code paths (not a real emulator).
(function () {
  const listeners = {}; let pending = null;
  const JOINTS = ['wrist','thumb-tip','index-finger-metacarpal','index-finger-tip','middle-finger-tip'];
  function mkHand(side) { const m = new Map(); JOINTS.forEach(j => m.set(j, { joint: j, side })); return m; }
  const hands = { left: { pos: { 'index-finger-tip': [-0.2, -0.1, -0.2] } }, right: { pos: { 'index-finger-tip': [0.2, -0.1, -0.2] } } };
  const src = side => ({ handedness: side, hand: mkHand(side), targetRaySpace: { ray: side }, gripSpace: null, profiles: [] });
  window.__xr = { hands, ray: { right: null }, fire(type, side) { listeners[type] && listeners[type]({ inputSource: session.inputSources.find(s => s.handedness === side) }); },
    step(n, t0) { for (let i = 0; i < (n || 1); i++) { const cb = pending; pending = null; cb && cb((t0 || 0) + i * 16, frame); } } };
  const ident = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const proj = new Float32Array([1.2,0,0,0, 0,1.2,0,0, 0,0,-1.002,-1, 0,0,-0.02,0]);
  const view = (x) => ({ eye: x < 0 ? 'left' : 'right', projectionMatrix: proj,
    transform: { position: { x, y: 0, z: 0 }, matrix: new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1]),
      inverse: { matrix: new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,-x,0,0,1]) } } });
  const frame = {
    getViewerPose() { return { transform: { matrix: ident, position: { x: 0, y: 0, z: 0 } }, views: [view(-0.032), view(0.032)] }; },
    getPose(space) { if (space.ray) { const m = window.__xr.ray[space.ray]; return m ? { transform: { matrix: m } } : { transform: { matrix: new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,space.ray==='left'?-0.2:0.2,-0.25,-0.1,1]) } }; } return null; },
    getJointPose(space) { const p = hands[space.side].pos[space.joint] || [0, -0.3, -0.1]; return { transform: { position: { x: p[0], y: p[1], z: p[2] } }, radius: 0.008 }; }
  };
  const session = { inputSources: [src('left'), src('right')], renderState: {}, visibilityState: 'visible',
    updateRenderState(s) { this.renderState.baseLayer = s.baseLayer; },
    requestReferenceSpace() { return Promise.resolve({ addEventListener() {} }); },
    addEventListener(t, f) { listeners[t] = f; }, requestAnimationFrame(cb) { pending = cb; }, end() { listeners.end && listeners.end(); } };
  window.XRWebGLLayer = function () { this.framebuffer = null; this.getViewport = v => ({ x: v.eye === 'left' ? 0 : 640, y: 0, width: 640, height: 800 }); };
  Object.defineProperty(navigator, 'xr', { value: { isSessionSupported: () => Promise.resolve(true), requestSession: () => Promise.resolve(session) } });
})();
// headless Chromium has no XR device, so stub makeXRCompatible for the test
[window.WebGL2RenderingContext, window.WebGLRenderingContext].forEach(C => { if (C) C.prototype.makeXRCompatible = () => Promise.resolve(); });
