/**
 * Ambient arena particles (BoardTheme.ambient): a light, never-distracting drift over the field —
 * moonrune mist motes, emberforge embers, blightmire spores, frostkeep snow, madcrown demon-fire
 * motes, apex star twinkles. Shared by both views:
 *  - the motion is a pure function of (seed, time), so nothing is simulated or allocated per frame:
 *    `sampleAmbient` writes into a caller-owned AmbientSample (WebGL: AmbientPoints in boardFx.ts,
 *    one Points draw; Canvas2D: `drawAmbient2D`, cached sprites);
 *  - particles live in field coordinates (cells, x left -> right, y top -> bottom, 0..BOARD_SIZE)
 *    and stay over the field, under the pieces and every marker;
 *  - the views tick it at ambientFrameMs (~10–20 fps by theme) only while the page is visible,
 *    motion is allowed (never with prefers-reduced-motion) and 절전 모드 is off.
 * Pure Canvas2D + math: no three.js here (the 2D fallback stays light).
 */
import { BOARD_SIZE } from '../engine/types';
import { hexToRgb, makeRng, mixRgb, rgbToCss } from './common';
import type { RGB } from './common';
import type { AmbientSpec } from './arenaThemes';

/** Most particles any theme uses (buffers are sized once). */
export const AMBIENT_MAX = 32;
/** Fastest frame rate of the ambient drift alone (~20 fps; for the quickest themes). */
export const AMBIENT_FRAME_MS = 50;
/** Slowest (~10 fps): the gentlest drifts move well under a pixel per frame even then. */
const AMBIENT_SLOW_FRAME_MS = 100;
/** Travel (cells) a particle may cover between two frames: ~1 CSS px on a phone-sized board. */
const AMBIENT_FRAME_TRAVEL = 0.03;
/**
 * Busy-animation frame floor of both views (ms): a 120 / 144 Hz display draws every other refresh
 * (60 / 72 fps), 60 and 90 Hz displays draw every refresh. Moves stay smooth; the GPU does half the
 * work on high-refresh phones.
 */
export const BUSY_FRAME_MS = 10;
/** Busy-animation frame floor in 절전 모드 (setLowPower): ~30 fps on any display. */
export const LOW_POWER_FRAME_MS = 30;
/** Level (0..1) the selection / reach pulses rest at while their idle loop is off. */
export const PULSE_REST = 0.75;

/**
 * Frame interval (ms) while only the ambient drift of `spec` animates: derived from its fastest
 * particle speed (rise + sway, see sampleAmbient) so each frame moves a particle about a pixel.
 * Slow themes (moonrune motes, apex twinkles) redraw at ~10 fps, fast ones (embers, snow) at ~20.
 * On an idle board this drift is usually the only thing redrawn, so its rate sets the idle cost.
 */
export function ambientFrameMs(spec: AmbientSpec): number {
  // Peak speeds (cells / s) of the motion in sampleAmbient: rise (or twinkle drift) and side sway.
  const rise = spec.speed * 1.4;
  let sway = 0;
  if (spec.kind === 'snow') sway = 0.35 * 1.1;
  else if (spec.kind !== 'twinkle') {
    const amp = spec.kind === 'spores' ? 0.45 : spec.kind === 'motes' ? 0.3 : 0.18;
    sway = amp * (spec.kind === 'embers' ? 1.6 : 0.6) * 1.3;
  }
  const v = Math.hypot(rise, sway);
  const ms = v > 0 ? (1000 * AMBIENT_FRAME_TRAVEL) / v : AMBIENT_SLOW_FRAME_MS;
  return Math.round(Math.min(AMBIENT_SLOW_FRAME_MS, Math.max(AMBIENT_FRAME_MS, ms)));
}

/** Per-particle seeds: x, y, phase, variance (deterministic: identical on every device). */
const SEEDS = (() => {
  const rnd = makeRng(0xa4b1e7);
  const a = new Float32Array(AMBIENT_MAX * 4);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
})();

/** One particle at one moment (reused: never allocate per frame). */
export interface AmbientSample {
  /** Field position in cells (x left -> right, y top -> bottom). */
  x: number;
  y: number;
  /** Opacity 0..1 (already scaled by the spec's alpha). */
  a: number;
  /** Diameter in cells. */
  size: number;
  /** Which of the spec's two colours (0 / 1). */
  color: 0 | 1;
}

export const makeAmbientSample = (): AmbientSample => ({ x: 0, y: 0, a: 0, size: 0, color: 0 });

const TAU = Math.PI * 2;
const N = BOARD_SIZE;
/** Vertical travel span (the particle enters half a cell outside the field and leaves the same). */
const SPAN = N + 1;

const mod = (v: number, m: number): number => ((v % m) + m) % m;

/** Particle `i` of `spec` at time `t` (seconds) into `out`. */
export function sampleAmbient(spec: AmbientSpec, i: number, t: number, out: AmbientSample): AmbientSample {
  const sx = SEEDS[i * 4];
  const sy = SEEDS[i * 4 + 1];
  const sp = SEEDS[i * 4 + 2] * TAU;
  const sv = SEEDS[i * 4 + 3];
  const d = t * spec.speed * (0.6 + 0.8 * sv);
  out.color = sv > 0.5 ? 1 : 0;
  out.size = spec.size * (0.7 + 0.6 * sv);
  switch (spec.kind) {
    case 'snow': {
      const u = mod(sy * SPAN + d, SPAN) / SPAN;
      out.y = -0.5 + u * SPAN;
      out.x = sx * N + 0.35 * Math.sin(t * (0.5 + sv * 0.6) + sp);
      out.a = spec.alpha * Math.min(1, Math.sin(Math.PI * u) * 2.2);
      break;
    }
    case 'twinkle': {
      out.x = mod(sx * N + d, N);
      out.y = 0.2 + sy * (N - 0.4);
      const w = Math.max(0, Math.sin(t * (0.55 + sv * 0.7) + sp));
      const tw = w * w * w * w * w * w;
      out.a = spec.alpha * tw;
      out.size *= 0.5 + tw * 0.7;
      break;
    }
    default: {
      // Rising: embers / motes / spores, fading in at the bottom and out near the top.
      const u = mod(sy * SPAN + d, SPAN) / SPAN;
      out.y = N + 0.5 - u * SPAN;
      const sway = spec.kind === 'spores' ? 0.45 : spec.kind === 'motes' ? 0.3 : 0.18;
      out.x = sx * N + sway * Math.sin(t * (spec.kind === 'embers' ? 1.6 : 0.6) * (0.7 + sv * 0.6) + sp);
      let a = Math.sin(Math.PI * u);
      if (spec.kind === 'embers') a *= (1 - u * 0.55) * (0.7 + 0.3 * Math.sin(t * 9 + sp * 3));
      out.a = spec.alpha * a;
    }
  }
  return out;
}

// ---------------------------------------------------------------- Canvas2D

/** Sprite pair per spec (one per colour): a few tiny canvases, freed by clearAmbientSprites. */
const sprites = new Map<AmbientSpec, readonly [HTMLCanvasElement, HTMLCanvasElement] | null>();
const SPRITE_PX = 32;

function spritesOf(spec: AmbientSpec): readonly [HTMLCanvasElement, HTMLCanvasElement] | null {
  if (sprites.has(spec)) return sprites.get(spec) ?? null;
  const star = spec.kind === 'twinkle';
  const a = sprite(spec.colors[0], star);
  const b = sprite(spec.colors[1], star);
  const pair = a && b ? ([a, b] as const) : null;
  sprites.set(spec, pair);
  return pair;
}

function sprite(hex: string, star: boolean): HTMLCanvasElement | null {
  const cvs = document.createElement('canvas');
  cvs.width = SPRITE_PX;
  cvs.height = SPRITE_PX;
  const g = cvs.getContext('2d');
  if (!g) return null;
  const c: RGB = hexToRgb(hex);
  const core = mixRgb(c, [1, 1, 1], 0.6);
  const h = SPRITE_PX / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, rgbToCss(core, 1));
  gr.addColorStop(0.25, rgbToCss(c, 0.85));
  gr.addColorStop(0.6, rgbToCss(c, 0.2));
  gr.addColorStop(1, rgbToCss(c, 0));
  g.fillStyle = gr;
  if (star) {
    // Soft core plus a thin four-point flare.
    g.beginPath();
    g.arc(h, h, h * 0.5, 0, TAU);
    g.fill();
    g.fillRect(h - 0.75, 0, 1.5, SPRITE_PX);
    g.fillRect(0, h - 0.75, SPRITE_PX, 1.5);
  } else {
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  }
  return cvs;
}

export function clearAmbientSprites(): void {
  for (const pair of sprites.values()) {
    for (const c of pair ?? []) {
      c.width = 0;
      c.height = 0;
    }
  }
  sprites.clear();
}

const sample2d = makeAmbientSample();

/**
 * Draw the ambient particles of `spec` at time `t` (s) onto a 2D context whose field top-left is
 * (x0, y0) with `cell` px per cell. Additive, no allocations after the first call per colour.
 */
export function drawAmbient2D(g: CanvasRenderingContext2D, spec: AmbientSpec, t: number, x0: number, y0: number, cell: number): void {
  const pair = spritesOf(spec);
  if (!pair) return;
  const s0 = pair[0];
  const s1 = pair[1];
  const n = Math.min(AMBIENT_MAX, spec.count);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const p = sampleAmbient(spec, i, t, sample2d);
    if (p.a <= 0.01) continue;
    // The sprite's soft halo is about 2.6x the visible core.
    const r = p.size * cell * 1.3;
    g.globalAlpha = Math.min(1, p.a);
    g.drawImage(p.color ? s1 : s0, x0 + p.x * cell - r, y0 + p.y * cell - r, r * 2, r * 2);
  }
  g.restore();
}
