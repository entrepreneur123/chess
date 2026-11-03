/** Lightweight result-moment effects: canvas confetti and a number count-up. Both self-clean. */
import { prefersReducedMotion } from '../dom';
import { overlayRoot } from './overlay';

// Dark Arena accents: candle gold, team blue, arcane, team red, ink.
const COLORS = ['#f2c14e', '#ffe7a3', '#c8891e', '#3b8bff', '#8cc2ff', '#8b6cff', '#ff9aa0', '#eef2ff'];

/**
 * Burst of confetti from the top-center. Returns a disposer (also auto-removes after ~3.2s).
 * All particle state lives in preallocated typed arrays: no per-frame allocation.
 */
export function confetti(opts: { count?: number; durationMs?: number } = {}): () => void {
  if (prefersReducedMotion()) return () => {};
  const n = opts.count ?? 140;
  const life = opts.durationMs ?? 3200;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  ctx.scale(dpr, dpr);
  overlayRoot().appendChild(canvas);

  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const rot = new Float32Array(n);
  const vr = new Float32Array(n);
  const size = new Float32Array(n);
  const wob = new Float32Array(n);
  const col = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // Two cannons from the upper corners plus a center pop.
    const side = i % 3;
    x[i] = side === 0 ? w * 0.1 : side === 1 ? w * 0.9 : w * 0.5;
    y[i] = side === 2 ? hgt * 0.32 : hgt * 0.18;
    const ang = side === 0 ? -Math.PI / 3 : side === 1 ? (-2 * Math.PI) / 3 : -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const sp = 6 + Math.random() * 9;
    vx[i] = Math.cos(ang + (Math.random() - 0.5) * 0.7) * sp;
    vy[i] = Math.sin(ang + (Math.random() - 0.5) * 0.7) * sp;
    rot[i] = Math.random() * Math.PI;
    vr[i] = (Math.random() - 0.5) * 0.4;
    size[i] = 5 + Math.random() * 6;
    wob[i] = Math.random() * Math.PI * 2;
    col[i] = (Math.random() * COLORS.length) | 0;
  }

  let raf = 0;
  let start = 0;
  let last = 0;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    canvas.remove();
  };
  const frame = (t: number) => {
    if (disposed) return;
    if (!start) start = last = t;
    const dt = Math.min(2.5, (t - last) / 16.67);
    last = t;
    const age = t - start;
    if (age > life) {
      dispose();
      return;
    }
    ctx.clearRect(0, 0, w, hgt);
    ctx.globalAlpha = age > life - 600 ? Math.max(0, (life - age) / 600) : 1;
    for (let i = 0; i < n; i++) {
      vy[i] += 0.28 * dt;
      vx[i] *= 0.985;
      vy[i] *= 0.985;
      wob[i] += 0.12 * dt;
      x[i] += (vx[i] + Math.sin(wob[i]) * 0.6) * dt;
      y[i] += vy[i] * dt;
      rot[i] += vr[i] * dt;
      if (y[i] > hgt + 20) continue;
      const s = size[i];
      ctx.fillStyle = COLORS[col[i]];
      ctx.setTransform(dpr, 0, 0, dpr, x[i] * dpr, y[i] * dpr);
      ctx.rotate(rot[i]);
      ctx.fillRect(-s / 2, (-s / 2) * Math.abs(Math.cos(wob[i])), s, s * 0.6 * Math.abs(Math.cos(wob[i])) + 1);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.setTimeout(dispose, life + 200);
  return dispose;
}
