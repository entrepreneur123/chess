import { BoardView } from '../src/render/BoardView';
import type { Piece, Move } from '../src/engine/types';

const errors: string[] = [];
const origErr = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); origErr(...a); };
window.addEventListener('error', (e) => errors.push(String(e.message)));

const W = window as any;
W.__errors = errors;
W.__make = () => new BoardView(document.getElementById('c')!);
W.__bv = W.__make();
W.__gallery = (): Piece[] => {
  const out: Piece[] = [];
  const chars = ['sad', 'marki', 'walk'] as const;
  chars.forEach((ch, ci) => {
    for (const lv of [1, 2, 3] as const) {
      out.push({ id: `b-${ch}-${lv}`, owner: 0, character: ch, level: lv, pos: { r: 1 + ci * 2, c: (lv - 1) * 2 + 0 } });
      out.push({ id: `r-${ch}-${lv}`, owner: 1, character: ch, level: lv, pos: { r: 10 - ci * 2, c: (lv - 1) * 2 + 7 } });
    }
  });
  return out;
};
W.__ready = async () => {
  for (let i = 0; i < 200; i++) {
    const bv = W.__bv;
    if (bv.units) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
W.__frameStats = async (ms: number) => {
  const bv = W.__bv;
  const orig = bv.frame;
  let n = 0, total = 0, rendered = 0;
  const r0 = bv.renderer.info.render.frame;
  // wrap rAF callback timing
  const raf = window.requestAnimationFrame.bind(window);
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => raf((t) => { const a = performance.now(); cb(t); total += performance.now() - a; n++; });
  bv.requestRender();
  await new Promise((r) => setTimeout(r, ms));
  (window as any).requestAnimationFrame = raf;
  rendered = bv.renderer.info.render.frame - r0;
  void orig;
  return { callbacks: n, jsMs: total, rendered, perRenderedMs: total / Math.max(1, rendered), info: bv.getRenderInfo() };
};
export {};
W.__solo = (ch: string, lv: number, owner: number, az: number, el: number, dist: number, clip?: string, t?: number) => {
  const bv = W.__bv;
  bv.setIdleAnimation(false);
  bv.setPieces([{ id: 'solo', owner, character: ch, level: lv, pos: { r: 5, c: 5 } }]);
  const v = bv.visuals.get('solo');
  if (clip && v.actor) { v.actor.play(clip, { fade: 0 }); v.actor.update(t ?? 0.3); }
  const cam = bv.camera;
  const tx = -0.5, tz = 0.5, ty = 0.75;
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  cam.position.set(tx + Math.sin(a) * Math.cos(e) * dist, ty + Math.sin(e) * dist, tz + Math.cos(a) * Math.cos(e) * dist);
  cam.near = 0.1; cam.far = 100; cam.fov = 30; cam.updateProjectionMatrix();
  cam.lookAt(tx, ty, tz);
  bv.camBase.copy(cam.position);
  bv.requestRender();
};
// ---- deterministic animation stepping
let fakeNow = 0;
let manual = false;
const realNow = performance.now.bind(performance);
performance.now = () => (manual ? fakeNow : realNow());
const realRaf = window.requestAnimationFrame.bind(window);
W.__manual = (on: boolean) => {
  manual = on;
  (window as any).requestAnimationFrame = on ? (() => 1) : realRaf;
  if (on) { fakeNow = 10000; W.__bv.rafId = 0; }
};
W.__step = (ms: number) => {
  const bv = W.__bv;
  // advance in 16 ms frames so mixers integrate smoothly
  const end = fakeNow + ms;
  while (fakeNow < end) { fakeNow = Math.min(end, fakeNow + 16); bv.rafId = 0; bv.lastFrame = 0; bv.frame(fakeNow); }
};
W.__cam = (x: number, z: number, d: number, el = 50, az = 0) => {
  const bv = W.__bv; const cam = bv.camera; const e = el * Math.PI / 180; const a = az * Math.PI / 180;
  cam.position.set(x + Math.sin(a) * Math.cos(e) * d, 0.6 + Math.sin(e) * d, z + Math.cos(a) * Math.cos(e) * d); cam.near = 0.1; cam.far = 200; cam.updateProjectionMatrix(); cam.lookAt(x, 0.6, z); bv.camBase.copy(cam.position);
};
W.__scenario = (name: string) => {
  const bv = W.__bv;
  const P = (id: string, owner: 0 | 1, character: any, level: any, r: number, c: number, dir?: 1 | -1): Piece => ({ id, owner, character, level, pos: { r, c }, ...(dir ? { dir } : {}) });
  let pieces: Piece[] = []; let move: Move | null = null; let after: Piece[] = [];
  if (name === 'sad') {
    pieces = [P('a', 0, 'sad', 3, 4, 4), P('v', 1, 'walk', 2, 7, 4)];
    move = { pieceId: 'a', from: { r: 4, c: 4 }, to: { r: 7, c: 4 }, captureId: 'v' };
    after = [P('a', 0, 'sad', 3, 7, 4)];
  } else if (name === 'walk') {
    pieces = [P('a', 0, 'walk', 3, 4, 4), P('v', 1, 'marki', 2, 6, 4)];
    move = { pieceId: 'a', from: { r: 4, c: 4 }, to: { r: 6, c: 4 }, captureId: 'v' };
    after = [P('a', 0, 'walk', 3, 6, 4)];
  } else if (name === 'marki') {
    pieces = [P('a', 1, 'marki', 3, 8, 4), P('v', 0, 'sad', 1, 5, 4)];
    move = { pieceId: 'a', from: { r: 8, c: 4 }, to: { r: 5, c: 4 }, captureId: 'v' };
    after = [P('a', 1, 'marki', 3, 5, 4)];
  } else if (name === 'turn') {
    pieces = [P('a', 0, 'walk', 1, 10, 4, 1), P('b', 0, 'marki', 2, 10, 6, 1)];
    move = null;
    after = [P('a', 0, 'walk', 1, 10, 4, -1), P('b', 0, 'marki', 2, 10, 6, -1)];
  } else if (name === 'slide') {
    pieces = [P('a', 0, 'sad', 2, 4, 4)];
    move = { pieceId: 'a', from: { r: 4, c: 4 }, to: { r: 6, c: 6 } };
    after = [P('a', 0, 'sad', 2, 6, 6)];
  }
  bv.setPieces(pieces);
  W.__done = false;
  if (move) bv.animateMove(move, after).then(() => { W.__done = true; });
  else bv.setPieces(after);
};
import { UnitActor } from '../src/render/units/actor';
let mixMs = 0, mixCalls = 0;
const origUpdate = UnitActor.prototype.update;
UnitActor.prototype.update = function (dt: number) { const a = realNow(); origUpdate.call(this, dt); mixMs += realNow() - a; mixCalls++; };
W.__perf = async (pieces: Piece[], ms: number, idle = true) => {
  const bv = W.__bv;
  bv.setIdleAnimation(idle);
  bv.setPieces(pieces);
  bv.setHighlights({});
  await new Promise((r) => setTimeout(r, 500));
  mixMs = 0; mixCalls = 0;
  let n = 0, total = 0;
  const r0 = bv.renderer.info.render.frame;
  const raf = window.requestAnimationFrame;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => raf((t) => { const a = realNow(); cb(t); total += realNow() - a; n++; });
  bv.rafId = 0; bv.requestRender();
  await new Promise((r) => setTimeout(r, ms));
  (window as any).requestAnimationFrame = raf;
  const rendered = bv.renderer.info.render.frame - r0;
  bv.renderer.render(bv.scene, bv.camera);
  return { seconds: ms / 1000, rafCallbacks: n, rendered, renderedFps: rendered / (ms / 1000), jsMsPerRenderedFrame: +(total / Math.max(1, rendered)).toFixed(2), mixerMsPerActorUpdate: +(mixMs / Math.max(1, mixCalls)).toFixed(4), info: bv.getRenderInfo() };
};
W.__six = (): Piece[] => [
  { id: 'a', owner: 0, character: 'sad', level: 3, pos: { r: 0, c: 3 } },
  { id: 'b', owner: 0, character: 'marki', level: 2, pos: { r: 1, c: 5 } },
  { id: 'c', owner: 0, character: 'walk', level: 1, pos: { r: 2, c: 8 } },
  { id: 'd', owner: 1, character: 'sad', level: 1, pos: { r: 11, c: 8 } },
  { id: 'e', owner: 1, character: 'marki', level: 3, pos: { r: 10, c: 6 } },
  { id: 'f', owner: 1, character: 'walk', level: 2, pos: { r: 9, c: 3 } },
];
W.__pickTest = () => {
  const bv = W.__bv;
  const got: any[] = [];
  bv.onCellClick((p: any) => got.push(p));
  bv.setInteractive(true);
  const canvas: HTMLCanvasElement = bv.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const THREE_V = bv.camera.position.clone();
  const res: any[] = [];
  const squares = [[0, 0], [11, 11], [0, 11], [11, 0], [5, 5], [6, 6], [5, 6]];
  for (const [r, c] of squares) {
    const v = THREE_V.set(c - 5.5, 0.09, 5.5 - r).project(bv.camera);
    const x = rect.left + (v.x + 1) / 2 * rect.width, y = rect.top + (1 - v.y) / 2 * rect.height;
    got.length = 0;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch', bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch', bubbles: true }));
    res.push({ want: [r, c], got: got[0] ? [got[0].r, got[0].c] : null });
  }
  // Tap on a unit's head (above its square) must select that unit's square.
  for (const v of bv.visuals.values()) {
    const p = v.piece.pos;
    const top = v.proxy.scale.y * 0.85;
    const w = bv.camera.position.clone().set(p.c - 5.5, 0.09 + top, 5.5 - p.r).project(bv.camera);
    const x = rect.left + (w.x + 1) / 2 * rect.width, y = rect.top + (1 - w.y) / 2 * rect.height;
    got.length = 0;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' }));
    res.push({ head: v.piece.id, want: [p.r, p.c], got: got[0] ? [got[0].r, got[0].c] : null });
  }
  return res;
};
W.__cycles = async (n: number) => {
  for (let i = 0; i < n; i++) {
    W.__bv.dispose();
    W.__bv = W.__make();
    W.__bv.setPieces(W.__gallery());
    await new Promise((r) => setTimeout(r, 300));
    W.__bv.setPieces(W.__six());
    await W.__bv.animateMove({ pieceId: 'a', from: { r: 0, c: 3 }, to: { r: 3, c: 3 } }, W.__six().map((p: Piece) => p.id === 'a' ? { ...p, pos: { r: 3, c: 3 } } : p));
  }
  const info = W.__bv.getRenderInfo();
  return { errors: W.__errors.slice(), info, hasUnits: !!W.__bv.units };
};
