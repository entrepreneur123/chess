/**
 * Rakaeli (라카엘리) and his transform "타천" on both boards: identity helpers, the shared FX
 * timeline, the canvas painters / 2D sprite caches and the WebGL layers.
 *
 *  - `awakenOf(piece)` = transformed moves left (2, then 1; 0 = base form). The engine field
 *    `Piece.awaken` is read through a structural cast so this compiles with or without it.
 *  - Timeline (`awakenTimeline` / `sampleAwaken`): one source of truth for the transform-in ('on':
 *    blindfold-burn flash, flame wings unfolding, a pulse, the face swap at the peak, the aura
 *    igniting) and the revert ('off': embers fading, a smoke puff, the face swapping back). Reduced
 *    motion: short fades only.
 *  - Painters: the countdown badge (a crimson flame drop with the number), the idle aura ring and
 *    ember, the feather atlas (crimson-edged black feather / pale ash feather), one flame wing and a
 *    smoke puff. The 2D board blits cached sprites; the WebGL layers paint their own canvases and
 *    free them after upload (`releaseAfterUpload`), repainting them on context restore.
 *  - `AwakenMarks3D`: per transformed token, an additive aura decal (flickering crimson / violet
 *    flame ring + rising embers, all in one fragment shader driven by a shared time uniform: no
 *    per-frame CPU work or allocations) under the coin, and the countdown badge above it.
 *  - `RakaeliFx3D`: pooled feathers (one instanced draw), the two flame wings of the transform and
 *    the dark-flame impact decal of a transformed capture.
 */
import * as THREE from 'three';
import type { Level, Piece } from '../engine/types';
import { ctx2d } from './diag';
import { MAX_CANVAS_SIDE, releaseAfterUpload } from './textures';

// ---------------------------------------------------------------- identity / state

/** Character id of Rakaeli (kept as a string so this compiles before `CharacterId` has it). */
export const RAKAELI_ID = 'rakaeli';

/** True for Rakaeli pieces (any form). */
export function isRakaeli(p: Pick<Piece, 'character'>): boolean {
  return (p.character as string) === RAKAELI_ID;
}

/** Transformed moves left (2, then 1); 0 when the piece is in its base form. */
export function awakenOf(p: Piece): number {
  const a = (p as Piece & { awaken?: unknown }).awaken;
  return typeof a === 'number' && Number.isFinite(a) && a > 0 ? Math.floor(a) : 0;
}

/** Move / capture FX style of a mover: transformed (crimson), base Rakaeli (pale ash) or none. */
export type RakaeliStyle = 'awake' | 'ash';
export function rakaeliStyle(p: Piece): RakaeliStyle | null {
  if (awakenOf(p) > 0) return 'awake';
  return isRakaeli(p) ? 'ash' : null;
}

/** Transformed face art (missing: the base face with a crimson tint is drawn instead). */
export function awakeFaceUrl(level: Level): string {
  return `./chars/${RAKAELI_ID}-awake-lv${level}-face.jpg`;
}

/** Transform palette (sRGB hex). Crimson / ember / violet over near-black; ash for the base form. */
export const AWAKEN_COLORS = {
  crimson: '#FF2742',
  ember: '#FF7A3D',
  violet: '#9A3CFF',
  core: '#FFE0D4',
  /** Near-black crimson of the feathers, the dark flame and the badge. */
  deep: '#1A0610',
  smoke: '#2A1022',
  ash: '#D9D3E0',
  ashEdge: '#F6F3FA',
  ashDark: '#7D7688',
} as const;

/** Crimson tint applied to the base face when the transformed art is missing (multiply colour). */
export const AWAKE_TINT: [number, number, number] = [1.0, 0.36, 0.4];

// ---------------------------------------------------------------- timeline

export type AwakenPhase = 'on' | 'off';

/** Times in ms from the start of `playAwaken`; Infinity = that part is skipped. */
export interface AwakenTimeline {
  duration: number;
  /** Face cross-fade (the swap at the peak). */
  swapAt: number;
  swapMs: number;
  /** Aura ramp (on: ignite, off: embers fade). */
  auraAt: number;
  auraMs: number;
  /** Blindfold-burn band on the face. */
  burnAt: number;
  burnMs: number;
  /** Flame wings: unfold, hold, fade. */
  wingAt: number;
  wingMs: number;
  wingFadeAt: number;
  wingFadeMs: number;
  /** One-shot pulse (on) or smoke puff (off). */
  pulseAt: number;
  smokeAt: number;
}

export function awakenTimeline(phase: AwakenPhase, reduced: boolean): AwakenTimeline {
  const I = Infinity;
  if (reduced) {
    return phase === 'on'
      ? { duration: 300, swapAt: 0, swapMs: 240, auraAt: 0, auraMs: 300, burnAt: I, burnMs: 1, wingAt: I, wingMs: 1, wingFadeAt: I, wingFadeMs: 1, pulseAt: I, smokeAt: I }
      : { duration: 280, swapAt: 0, swapMs: 220, auraAt: 0, auraMs: 260, burnAt: I, burnMs: 1, wingAt: I, wingMs: 1, wingFadeAt: I, wingFadeMs: 1, pulseAt: I, smokeAt: I };
  }
  return phase === 'on'
    ? { duration: 1300, swapAt: 440, swapMs: 110, auraAt: 470, auraMs: 450, burnAt: 0, burnMs: 420, wingAt: 240, wingMs: 560, wingFadeAt: 980, wingFadeMs: 320, pulseAt: 470, smokeAt: I }
    : { duration: 820, swapAt: 280, swapMs: 140, auraAt: 0, auraMs: 560, burnAt: I, burnMs: 1, wingAt: I, wingMs: 1, wingFadeAt: I, wingFadeMs: 1, pulseAt: I, smokeAt: 260 };
}

/** One frame of the transform FX (all 0..1). */
export interface AwakenSample {
  /** Awake face blend (0 = base face, 1 = transformed face). */
  face: number;
  /** Idle aura / embers intensity. */
  aura: number;
  /** Blindfold-burn progress (0 = none / done). */
  burn: number;
  /** Wing unfold (0 folded .. 1 open, may overshoot slightly) and opacity. */
  wingK: number;
  wingA: number;
}

export function makeAwakenSample(): AwakenSample {
  return { face: 0, aura: 0, burn: 0, wingK: 0, wingA: 0 };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number): number => {
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const ramp = (at: number, ms: number, t: number): number => (at === Infinity ? 0 : clamp01((t - at) / Math.max(1, ms)));

/**
 * Sample the FX at `t` ms. `face0` / `aura0` are the values when the call started (a revert that
 * begins mid-fade continues from there). Writes into `out` (no allocation) and returns it.
 */
export function sampleAwaken(phase: AwakenPhase, tl: AwakenTimeline, t: number, face0: number, aura0: number, out: AwakenSample): AwakenSample {
  const sw = easeInOut(ramp(tl.swapAt, tl.swapMs, t));
  const au = ramp(tl.auraAt, tl.auraMs, t);
  if (phase === 'on') {
    out.face = face0 + (1 - face0) * sw;
    out.aura = aura0 + (1 - aura0) * easeOut(au);
  } else {
    out.face = face0 * (1 - sw);
    out.aura = aura0 * (1 - au * au);
  }
  const b = tl.burnAt === Infinity ? 1 : (t - tl.burnAt) / tl.burnMs;
  out.burn = b > 0 && b < 1 ? b : 0;
  if (tl.wingAt === Infinity || t < tl.wingAt) {
    out.wingK = 0;
    out.wingA = 0;
  } else {
    const wk = clamp01((t - tl.wingAt) / tl.wingMs);
    out.wingK = easeOutBack(wk);
    const fade = ramp(tl.wingFadeAt, tl.wingFadeMs, t);
    out.wingA = Math.min(1, wk * 3) * (1 - fade * fade);
  }
  return out;
}

// ---------------------------------------------------------------- 2D layout constants (cells)

/** Countdown badge: sprite size and centre offset from the token centre (screen right / up). */
export const BADGE_BOX = 0.62;
export const BADGE_OFFSET = 0.33;
/** Aura sprite / decal size (the flame ring hugs the coin, embers rise out to ~0.85). */
export const AURA_BOX = 1.9;
/** Coin radius (tokens.ts COIN_R) + its keyline: the aura ring starts just outside it. */
const AURA_R0 = 0.41;
/** Embers per aura (both boards). */
export const EMBER_COUNT = 10;

/** Ember `i` at `time` (s): radius (cells), angle, size (cells) and brightness (0..1). */
export function emberAt(i: number, time: number, out: { r: number; a: number; s: number; k: number }): void {
  const h = fract(Math.sin(i * 12.9898 + 4.1) * 43758.5453);
  const h2 = fract(Math.sin(i * 78.233 + 1.7) * 24634.6345);
  const ph = fract(time * (0.32 + 0.26 * h) + h2 * 7.1);
  out.r = AURA_R0 + 0.02 + 0.42 * ph;
  out.a = h * Math.PI * 2 + ph * (0.7 + h2) * (i % 2 ? 1 : -1);
  out.s = 0.04 * (1 - ph * 0.55) * (0.8 + 0.4 * h2);
  const flick = 0.65 + 0.35 * Math.sin(time * 13 + h * 40);
  out.k = (1 - ph) * clamp01(ph / 0.12) * flick;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

// ---------------------------------------------------------------- painters

const FONT = '"Exo 2 Variable", "Exo 2", Pretendard, "Apple SD Gothic Neo", system-ui, sans-serif';

/** Flame-drop outline centred on (x, y): a disc of radius r with a pointed flame tip on top. */
function dropPath(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.moveTo(x, y - r * 1.62);
  g.bezierCurveTo(x + r * 0.28, y - r * 1.2, x + r * 1.02, y - r * 0.82, x + r, y);
  g.arc(x, y, r, 0, Math.PI, false);
  g.bezierCurveTo(x - r * 1.02, y - r * 0.82, x - r * 0.28, y - r * 1.2, x, y - r * 1.62);
  g.closePath();
}

/**
 * Countdown badge on an S x S canvas (BADGE_BOX cells): a near-black crimson flame drop with a
 * glowing crimson rim and the number in bold white with a dark outline (legible at ~13 CSS px).
 */
export function paintAwakenBadge(g: CanvasRenderingContext2D, S: number, n: number): void {
  const c = S / 2;
  const r = S * 0.3;
  const y = c + S * 0.08;
  g.save();
  // Outer glow.
  const halo = g.createRadialGradient(c, y, r * 0.6, c, y, S * 0.5);
  halo.addColorStop(0, 'rgba(255,39,66,0.55)');
  halo.addColorStop(1, 'rgba(255,39,66,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  // Body.
  dropPath(g, c, y, r);
  const body = g.createRadialGradient(c - r * 0.3, y - r * 0.45, r * 0.1, c, y, r * 1.5);
  body.addColorStop(0, '#6A0E22');
  body.addColorStop(0.6, '#2B0612');
  body.addColorStop(1, AWAKEN_COLORS.deep);
  g.fillStyle = body;
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1.5, S * 0.07);
  g.strokeStyle = '#090D17';
  g.stroke();
  g.lineWidth = Math.max(1, S * 0.04);
  const rim = g.createLinearGradient(0, y - r * 1.6, 0, y + r);
  rim.addColorStop(0, '#FFC2A0');
  rim.addColorStop(0.35, AWAKEN_COLORS.ember);
  rim.addColorStop(1, AWAKEN_COLORS.crimson);
  g.strokeStyle = rim;
  g.stroke();
  // Number.
  const label = String(Math.max(0, Math.min(99, Math.floor(n))));
  const fs = Math.round(S * (label.length > 1 ? 0.4 : 0.5));
  g.font = `800 ${fs}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ty = y + S * 0.015;
  g.lineWidth = Math.max(2, S * 0.09);
  g.strokeStyle = '#12030A';
  g.strokeText(label, c, ty);
  g.shadowColor = 'rgba(255,60,80,0.9)';
  g.shadowBlur = S * 0.08;
  g.fillStyle = '#FFFFFF';
  g.fillText(label, c, ty);
  g.restore();
}

/**
 * The idle aura's static layer on an S x S canvas (AURA_BOX cells): a soft crimson-to-violet glow
 * ring hugging the coin with flame tongues. The 2D board rotates / flickers two copies of it.
 */
export function paintAuraRing(g: CanvasRenderingContext2D, S: number, seed: number): void {
  const u = S / AURA_BOX;
  const c = S / 2;
  const r0 = AURA_R0 * u;
  g.save();
  const glow = g.createRadialGradient(c, c, r0 * 0.9, c, c, r0 + u * 0.32);
  glow.addColorStop(0, 'rgba(255,39,66,0.7)');
  glow.addColorStop(0.35, 'rgba(200,30,120,0.38)');
  glow.addColorStop(0.7, 'rgba(154,60,255,0.14)');
  glow.addColorStop(1, 'rgba(154,60,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  const n = 22;
  for (let i = 0; i < n; i++) {
    const h = fract(Math.sin((i + seed * 31) * 12.9898) * 43758.5453);
    const a = (i / n) * Math.PI * 2 + h * 0.2;
    const len = u * (0.08 + 0.17 * h);
    const x0 = c + Math.cos(a) * r0;
    const y0 = c + Math.sin(a) * r0;
    const bend = (h - 0.5) * 0.6;
    const x1 = c + Math.cos(a + bend * 0.3) * (r0 + len);
    const y1 = c + Math.sin(a + bend * 0.3) * (r0 + len);
    const col = i % 3 === 0 ? 'rgba(154,60,255,0.8)' : i % 3 === 1 ? 'rgba(255,39,66,0.85)' : 'rgba(255,122,61,0.75)';
    g.strokeStyle = col;
    g.lineWidth = u * (0.05 + 0.03 * h);
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(c + Math.cos(a + bend) * (r0 + len * 0.55), c + Math.sin(a + bend) * (r0 + len * 0.55), x1, y1);
    g.stroke();
  }
  // Thin hot rim right at the coin edge.
  g.strokeStyle = 'rgba(255,190,170,0.55)';
  g.lineWidth = u * 0.025;
  g.beginPath();
  g.arc(c, c, r0 + u * 0.01, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** A glowing ember dot (white-hot core, crimson-ember halo) on an S x S canvas. */
export function paintEmber(g: CanvasRenderingContext2D, S: number): void {
  const c = S / 2;
  const e = g.createRadialGradient(c, c, 0, c, c, c);
  e.addColorStop(0, 'rgba(255,240,220,1)');
  e.addColorStop(0.25, 'rgba(255,122,61,0.95)');
  e.addColorStop(0.6, 'rgba(255,39,66,0.35)');
  e.addColorStop(1, 'rgba(255,39,66,0)');
  g.fillStyle = e;
  g.fillRect(0, 0, S, S);
}

/** Feather tones: 0 = crimson-edged black (transformed), 1 = pale ash (base form). */
export type FeatherTone = 0 | 1;

/** One feather (pointing up) in a w x h box at (ox, oy). */
export function paintFeather(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, tone: FeatherTone): void {
  const cx = ox + w / 2;
  g.save();
  const vane = (): void => {
    g.beginPath();
    g.moveTo(cx, oy + h * 0.04);
    g.bezierCurveTo(cx + w * 0.46, oy + h * 0.22, cx + w * 0.4, oy + h * 0.7, cx + w * 0.05, oy + h * 0.9);
    g.lineTo(cx - w * 0.05, oy + h * 0.9);
    g.bezierCurveTo(cx - w * 0.4, oy + h * 0.66, cx - w * 0.44, oy + h * 0.24, cx, oy + h * 0.04);
    g.closePath();
  };
  vane();
  const body = g.createLinearGradient(0, oy, 0, oy + h);
  if (tone === 0) {
    body.addColorStop(0, '#3A0A18');
    body.addColorStop(0.55, '#16050C');
    body.addColorStop(1, '#0A0206');
  } else {
    body.addColorStop(0, 'rgba(246,243,250,0.95)');
    body.addColorStop(0.6, 'rgba(206,199,214,0.85)');
    body.addColorStop(1, 'rgba(150,143,160,0.55)');
  }
  g.fillStyle = body;
  g.fill();
  // Barb notches cut into the vane.
  g.globalCompositeOperation = 'destination-out';
  g.lineWidth = Math.max(1, w * 0.06);
  for (const [s, y] of [
    [1, 0.42],
    [-1, 0.55],
    [1, 0.66],
  ] as const) {
    g.beginPath();
    g.moveTo(cx + s * w * 0.5, oy + h * (y - 0.08));
    g.lineTo(cx + s * w * 0.12, oy + h * y);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  // Edge: glowing crimson flame (transformed) or a soft pale rim (ash).
  vane();
  g.lineWidth = Math.max(1, w * (tone === 0 ? 0.09 : 0.05));
  g.strokeStyle = tone === 0 ? AWAKEN_COLORS.crimson : 'rgba(255,255,255,0.75)';
  if (tone === 0) {
    g.shadowColor = AWAKEN_COLORS.ember;
    g.shadowBlur = w * 0.2;
  }
  g.stroke();
  g.shadowBlur = 0;
  // Shaft.
  g.strokeStyle = tone === 0 ? 'rgba(255,122,61,0.8)' : 'rgba(120,112,132,0.8)';
  g.lineWidth = Math.max(1, w * 0.045);
  g.beginPath();
  g.moveTo(cx, oy + h * 0.1);
  g.quadraticCurveTo(cx + w * 0.03, oy + h * 0.6, cx, oy + h);
  g.stroke();
  g.restore();
}

/**
 * One flame wing on a W x H canvas (W:H = 1.6:1), shoulder at (0.06 W, 0.55 H), spreading right
 * and up: fanned black primaries edged in crimson flame with ember tips, coverts near the shoulder.
 */
export function paintWing(g: CanvasRenderingContext2D, W: number, H: number): void {
  const sx = W * 0.06;
  const sy = H * 0.55;
  g.save();
  const feather = (ang: number, len: number, wid: number, alpha: number): void => {
    g.save();
    g.translate(sx, sy);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.3, -wid, len * 0.8, -wid * 0.8, len, 0);
    g.bezierCurveTo(len * 0.8, wid * 0.55, len * 0.3, wid * 0.6, 0, 0);
    g.closePath();
    const f = g.createLinearGradient(0, 0, len, 0);
    f.addColorStop(0, `rgba(10,2,6,${alpha})`);
    f.addColorStop(0.7, `rgba(30,6,14,${alpha})`);
    f.addColorStop(1, `rgba(90,10,28,${alpha})`);
    g.fillStyle = f;
    g.fill();
    g.lineWidth = Math.max(1, H * 0.018);
    g.shadowColor = AWAKEN_COLORS.crimson;
    g.shadowBlur = H * 0.05;
    const e = g.createLinearGradient(0, 0, len, 0);
    e.addColorStop(0, 'rgba(255,39,66,0.25)');
    e.addColorStop(0.6, 'rgba(255,39,66,0.95)');
    e.addColorStop(1, 'rgba(255,170,110,1)');
    g.strokeStyle = e;
    g.stroke();
    g.restore();
  };
  // Primaries (back to front), then secondaries / coverts closer to the shoulder.
  const prim = 8;
  for (let i = 0; i < prim; i++) {
    const k = i / (prim - 1);
    feather(-1.25 + k * 1.45, W * (0.92 - 0.38 * k * k), H * (0.13 - 0.03 * k), 0.96);
  }
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    feather(-0.95 + k * 1.2, W * (0.45 - 0.12 * k), H * 0.1, 0.98);
  }
  // Flame licks along the leading edge.
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const k = i / 13;
    const a = -1.25 + k * 0.9;
    const rr = W * (0.3 + 0.6 * (1 - k * 0.4));
    const x = sx + Math.cos(a) * rr;
    const y = sy + Math.sin(a) * rr;
    const fl = g.createRadialGradient(x, y, 0, x, y, H * 0.12);
    fl.addColorStop(0, 'rgba(255,200,150,0.55)');
    fl.addColorStop(0.4, 'rgba(255,60,70,0.4)');
    fl.addColorStop(1, 'rgba(154,60,255,0)');
    g.fillStyle = fl;
    g.fillRect(x - H * 0.12, y - H * 0.12, H * 0.24, H * 0.24);
  }
  g.restore();
}

/** A soft dark smoke puff (crimson-black core) on an S x S canvas. */
export function paintSmoke(g: CanvasRenderingContext2D, S: number): void {
  const c = S / 2;
  const s = g.createRadialGradient(c, c, 0, c, c, c);
  s.addColorStop(0, 'rgba(42,16,34,0.85)');
  s.addColorStop(0.5, 'rgba(36,18,40,0.45)');
  s.addColorStop(1, 'rgba(30,20,40,0)');
  g.fillStyle = s;
  g.fillRect(0, 0, S, S);
}

// ---------------------------------------------------------------- 2D sprite caches

const sprites2d = new Map<string, HTMLCanvasElement>();
/** Size buckets keep the cache small while the board resizes. */
const bucket = (px: number, min: number): number => Math.max(min, Math.min(MAX_CANVAS_SIDE, Math.ceil(px / 8) * 8));

function cached(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let c = sprites2d.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = ctx2d(c);
    if (g) paint(g);
    sprites2d.set(key, c);
  }
  return c;
}

/** Countdown badge sprite (BADGE_BOX cells wide) at ~`px` device pixels. */
export function badgeSprite(n: number, px: number): HTMLCanvasElement {
  const S = bucket(px, 16);
  return cached(`badge:${n}:${S}`, S, S, (g) => paintAwakenBadge(g, S, n));
}

/** Aura ring sprite (AURA_BOX cells wide); two seeds so the layered copies differ. */
export function auraSprite(px: number, seed: 0 | 1): HTMLCanvasElement {
  const S = bucket(px, 24);
  return cached(`aura:${seed}:${S}`, S, S, (g) => paintAuraRing(g, S, seed));
}

export function emberSprite(px: number): HTMLCanvasElement {
  const S = bucket(px, 8);
  return cached(`ember:${S}`, S, S, (g) => paintEmber(g, S));
}

/** Feather sprite (1:2), `px` = height in device pixels. */
export function featherSprite(tone: FeatherTone, px: number): HTMLCanvasElement {
  const H = bucket(px, 16);
  const W = Math.round(H / 2);
  return cached(`feather:${tone}:${H}`, W, H, (g) => paintFeather(g, 0, 0, W, H, tone));
}

/** Right wing sprite (1.6:1), `px` = width in device pixels. */
export function wingSprite(px: number): HTMLCanvasElement {
  const W = bucket(px, 32);
  const H = Math.round(W / 1.6);
  return cached(`wing:${W}`, W, H, (g) => paintWing(g, W, H));
}

export function smokeSprite(px: number): HTMLCanvasElement {
  const S = bucket(px, 16);
  return cached(`smoke:${S}`, S, S, (g) => paintSmoke(g, S));
}

/** Drop every cached 2D sprite (board resize / dispose). Canvases are freed by the GC. */
export function clearAwakenSprites(): void {
  sprites2d.clear();
}

// ---------------------------------------------------------------- WebGL helpers

/** A texture painted into its own canvas, freed after upload and repainted by `restore()`. */
class PaintedTex {
  readonly tex: THREE.CanvasTexture;
  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly paint: (g: CanvasRenderingContext2D) => void,
  ) {
    this.tex = new THREE.CanvasTexture(this.canvas());
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 2;
    releaseAfterUpload(this.tex);
  }

  private canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.min(MAX_CANVAS_SIDE, this.w);
    c.height = Math.min(MAX_CANVAS_SIDE, this.h);
    const g = ctx2d(c);
    if (g) this.paint(g);
    return c;
  }

  /** WebGL context restored: the canvas was freed after the first upload, so paint it again. */
  restore(): void {
    this.tex.image = this.canvas();
    releaseAfterUpload(this.tex);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
  }
}

const NOISE_GLSL = /* glsl */ `
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = dot(i, vec2(1.0, 57.0));
  return mix(mix(hash1(n), hash1(n + 1.0), f.x), mix(hash1(n + 57.0), hash1(n + 58.0), f.x), f.y);
}`;

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const f4 = (x: number): string => x.toFixed(4);

/**
 * Idle aura (additive): a flickering crimson / violet flame ring hugging the coin, a soft halo and
 * EMBER_COUNT embers spiralling out (the same motion as `emberAt`). Quad = AURA_BOX cells.
 */
const AURA_FS = /* glsl */ `
uniform float uTime;
uniform float uK;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = (vUv - 0.5) * ${f4(AURA_BOX)};
  p.y = -p.y;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = r - ${f4(AURA_R0)};
  float n = vnoise(vec2(ang * 3.0 + uSeed, r * 8.0 - uTime * 2.2));
  float n2 = vnoise(vec2(ang * 7.0 - uSeed, r * 14.0 - uTime * 3.4));
  float flame = smoothstep(0.09 + 0.24 * n * n2 + 0.05 * n, 0.0, t) * smoothstep(-0.03, 0.005, t);
  float hueK = 0.5 + 0.5 * sin(ang * 2.0 + uTime * 0.9 + uSeed);
  vec3 crimson = vec3(1.0, 0.02, 0.055);
  vec3 violet = vec3(0.32, 0.045, 1.0);
  vec3 ember = vec3(1.0, 0.19, 0.045);
  vec3 col = mix(crimson, violet, hueK * 0.65) * flame * (1.15 + 0.5 * n2);
  col += mix(ember, vec3(1.0, 0.75, 0.6), n2) * flame * flame * 0.5;
  float halo = exp(-pow(max(t, 0.0) / 0.14, 2.0)) * step(-0.02, t);
  col += mix(crimson, violet, 0.4) * halo * 0.35;
  float emb = 0.0;
  for (int i = 0; i < ${EMBER_COUNT}; i++) {
    float fi = float(i);
    float h = fract(sin(fi * 12.9898 + 4.1) * 43758.5453);
    float h2 = fract(sin(fi * 78.233 + 1.7) * 24634.6345);
    float ph = fract(uTime * (0.32 + 0.26 * h) + h2 * 7.1);
    float side = mod(fi, 2.0) < 0.5 ? -1.0 : 1.0;
    float a = h * 6.2831853 + ph * (0.7 + h2) * side;
    float rr = ${f4(AURA_R0 + 0.02)} + 0.42 * ph;
    vec2 c = vec2(cos(a), sin(a)) * rr;
    float s = 0.04 * (1.0 - ph * 0.55) * (0.8 + 0.4 * h2);
    float d = length(p - c);
    float flick = 0.65 + 0.35 * sin(uTime * 13.0 + h * 40.0);
    emb += exp(-d * d / (s * s)) * (1.0 - ph) * clamp(ph / 0.12, 0.0, 1.0) * flick;
  }
  col += mix(ember, vec3(1.0, 0.9, 0.8), clamp(emb - 0.5, 0.0, 1.0)) * emb * 1.6;
  col *= uK * smoothstep(${f4(AURA_BOX / 2)}, ${f4(AURA_BOX / 2 - 0.1)}, r);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The transform marks of one token (children of the piece's lifted group). */
export interface AwakeMarks {
  group: THREE.Group;
  aura: THREE.Mesh;
  auraMat: THREE.ShaderMaterial;
  badge: THREE.Mesh;
  /** Number shown on the badge (0 = hidden). */
  count: number;
}

/**
 * Aura decals and countdown badges of transformed tokens. One aura material per marked token (at
 * most one Rakaeli per side; they differ in seed / intensity and share the time uniform), one
 * badge material per number (shared). Everything is created once per token and reused.
 */
export class AwakenMarks3D {
  readonly time = { value: 0 };
  private readonly auraGeo = new THREE.PlaneGeometry(AURA_BOX, AURA_BOX).rotateX(-Math.PI / 2);
  private readonly badgeGeo = new THREE.PlaneGeometry(BADGE_BOX, BADGE_BOX).rotateX(-Math.PI / 2);
  private readonly badges = new Map<number, { mat: THREE.MeshBasicMaterial; tex: PaintedTex }>();
  private readonly live = new Set<AwakeMarks>();
  private seed = 0;

  /**
   * `auraY` = height of the aura decal (relative to the token's group: just above the tile, under
   * the coin), `badgeY` = above the coin.
   */
  constructor(
    private readonly auraY: number,
    private readonly badgeY: number,
  ) {}

  /** A fresh material for the aura (also used once for the shader warm-up). */
  auraMaterial(): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uK: { value: 0 }, uSeed: { value: (this.seed++ % 7) * 1.37 } },
      vertexShader: QUAD_VS,
      fragmentShader: AURA_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    m.name = 'rakaeli-aura';
    return m;
  }

  create(): AwakeMarks {
    const group = new THREE.Group();
    group.name = 'awaken-marks';
    const auraMat = this.auraMaterial();
    const aura = new THREE.Mesh(this.auraGeo, auraMat);
    aura.position.y = this.auraY;
    // Above the rarity ring (2), under the coin (4).
    aura.renderOrder = 3;
    aura.raycast = () => undefined;
    aura.frustumCulled = false;
    const badge = new THREE.Mesh(this.badgeGeo, this.badgeMat(1));
    badge.position.set(BADGE_OFFSET, this.badgeY, -BADGE_OFFSET);
    // Above the token (4), the stun chain ring (7) and a corner doll (8).
    badge.renderOrder = 9;
    badge.raycast = () => undefined;
    badge.frustumCulled = false;
    badge.visible = false;
    aura.visible = false;
    group.add(aura, badge);
    const m: AwakeMarks = { group, aura, auraMat, badge, count: 0 };
    this.live.add(m);
    return m;
  }

  /** Aura intensity (0 hides it: no draw at all). */
  setAura(m: AwakeMarks, k: number): void {
    m.auraMat.uniforms.uK.value = k;
    m.aura.visible = k > 0.003;
  }

  /** Countdown number (0 hides the badge). */
  setCount(m: AwakeMarks, n: number): void {
    m.count = n;
    m.badge.visible = n > 0;
    if (n > 0) m.badge.material = this.badgeMat(n);
  }

  private badgeMat(n: number): THREE.MeshBasicMaterial {
    let b = this.badges.get(n);
    if (!b) {
      const tex = new PaintedTex(128, 128, (g) => paintAwakenBadge(g, 128, n));
      const mat = new THREE.MeshBasicMaterial({ map: tex.tex, transparent: true, depthWrite: false, depthTest: false });
      mat.name = 'rakaeli-badge';
      b = { mat, tex };
      this.badges.set(n, b);
    }
    return b.mat;
  }

  /** Shared animation clock (seconds); keep it fixed for a static aura (reduced motion). */
  update(timeS: number): void {
    this.time.value = timeS;
  }

  /** Free one token's marks (its own aura material); the group is detached by the caller. */
  release(m: AwakeMarks): void {
    m.group.removeFromParent();
    m.auraMat.dispose();
    this.live.delete(m);
  }

  restore(): void {
    for (const b of this.badges.values()) b.tex.restore();
  }

  dispose(): void {
    for (const m of this.live) m.auraMat.dispose();
    this.live.clear();
    for (const b of this.badges.values()) {
      b.mat.dispose();
      b.tex.dispose();
    }
    this.badges.clear();
    this.auraGeo.dispose();
    this.badgeGeo.dispose();
  }
}

/** Feathers: per-instance tone (atlas half) and alpha; texture = feather atlas (2 x 1). */
const FEATHER_VS = /* glsl */ `
attribute float aAlpha;
attribute float aTone;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = vec2((uv.x + aTone) * 0.5, uv.y);
  vA = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FEATHER_FS = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb, a);
  #include <colorspace_fragment>
}`;

/** Wing: painted texture with a flickering flame boost on its bright (edge) texels. */
const WING_FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uA;
uniform float uTime;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec4 t = texture2D(uMap, vUv);
  float hot = smoothstep(0.25, 0.9, max(t.r - t.b, 0.0));
  float n = vnoise(vUv * vec2(9.0, 6.0) + vec2(0.0, -uTime * 3.0));
  vec3 col = t.rgb + vec3(1.0, 0.18, 0.1) * hot * (0.3 + 0.9 * n);
  float a = t.a * uA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

/**
 * Dark-flame impact (premultiplied alpha): a smoky near-black core blooming out under crimson /
 * ember flame tongues licking from its rim, a white-hot flash at the start. Distinct from every
 * additive glow decal (it darkens the board).
 */
const DARK_FS = /* glsl */ `
uniform float uK;
uniform float uSeed;
uniform float uSize;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float k = clamp(uK, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - k, 3.0);
  float fade = 1.0 - k;
  float ang = atan(p.y, p.x);
  float R = 0.16 + 0.62 * e;
  float n = vnoise(vec2(ang * 4.0 + uSeed, r * 6.0 - k * 8.0));
  float n2 = vnoise(vec2(ang * 9.0 - uSeed, r * 15.0 - k * 14.0));
  // Smoky dark body: thick ring that hollows out as it grows.
  float body = smoothstep(R + 0.2 * n, R * 0.55, r) * smoothstep(R * 0.1, R * 0.6, r + 0.25 * fade);
  float darkA = body * pow(fade, 0.7) * 0.82 * uSize;
  // Flame tongues on the rim.
  float t = r - R;
  float flame = smoothstep(0.06 + 0.34 * n * n2 + 0.06 * n, 0.0, t) * smoothstep(-0.16, 0.0, t) * pow(fade, 0.6);
  vec3 crimson = vec3(1.0, 0.02, 0.055);
  vec3 ember = vec3(1.0, 0.19, 0.045);
  vec3 fcol = mix(crimson, ember, n2) * 1.6 + vec3(0.25, 0.02, 0.4) * (1.0 - n);
  float flash = exp(-r * r / 0.05) * pow(fade, 6.0) * 1.2;
  vec3 deep = vec3(0.012, 0.002, 0.006);
  vec3 col = deep * darkA + fcol * flame + vec3(1.0, 0.7, 0.6) * flash;
  float a = clamp(max(darkA, max(flame * 0.9, flash * 0.6)), 0.0, 1.0);
  float edge = smoothstep(1.0, 0.9, r);
  gl_FragColor = vec4(col * edge, a * edge);
  #include <colorspace_fragment>
}`;

/** Feathers in flight. */
const FEATHER_N = 40;

/**
 * Pooled feathers + the transform's wings + the dark-flame impact. Everything is pre-allocated;
 * `update` rewrites instance matrices / uniforms in place.
 */
export class RakaeliFx3D {
  readonly group = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly featherTex = new PaintedTex(128, 128, (g) => {
    paintFeather(g, 2, 2, 60, 124, 0);
    paintFeather(g, 66, 2, 60, 124, 1);
  });
  private readonly wingTex = new PaintedTex(256, 160, (g) => paintWing(g, 256, 160));
  private readonly feathers: THREE.InstancedMesh;
  private readonly fAlpha: THREE.InstancedBufferAttribute;
  private readonly fTone: THREE.InstancedBufferAttribute;
  /** Per feather: x y z vx vy vz rot spin size t0 life flutter (FS floats). */
  private readonly fs = new Float32Array(FEATHER_N * 12);
  private alive = 0;
  private nextSlot = 0;
  private lastT = 0;
  private readonly wings: [THREE.Mesh, THREE.Mesh];
  private readonly wingMat: THREE.ShaderMaterial;
  private readonly dark: THREE.Mesh;
  private readonly darkMat: THREE.ShaderMaterial;
  private darkT0 = -1;
  private darkDur = 1;
  /** A hidden aura copy so the warm-up compiles its program before the first transform. */
  readonly warmAura: THREE.Mesh;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(auraMat: THREE.ShaderMaterial) {
    this.group.name = 'rakaeli-fx';
    const fGeo = this.geo(new THREE.PlaneGeometry(1, 2).rotateX(-Math.PI / 2));
    const fMat = this.mat(
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: this.featherTex.tex } },
        vertexShader: FEATHER_VS,
        fragmentShader: FEATHER_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    fMat.name = 'rakaeli-feather';
    this.feathers = new THREE.InstancedMesh(fGeo, fMat, FEATHER_N);
    this.fAlpha = new THREE.InstancedBufferAttribute(new Float32Array(FEATHER_N), 1);
    this.fTone = new THREE.InstancedBufferAttribute(new Float32Array(FEATHER_N), 1);
    this.fAlpha.setUsage(THREE.DynamicDrawUsage);
    this.fTone.setUsage(THREE.DynamicDrawUsage);
    fGeo.setAttribute('aAlpha', this.fAlpha);
    fGeo.setAttribute('aTone', this.fTone);
    this.feathers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < FEATHER_N; i++) this.feathers.setMatrixAt(i, this.tmpM);
    this.feathers.frustumCulled = false;
    this.feathers.visible = false;
    this.feathers.renderOrder = 6;
    this.feathers.raycast = () => undefined;

    // Wings: one quad per side, its origin moved to the painted shoulder (0.06 W, 0.55 H).
    const W = 1.6;
    const H = 1.0;
    const wGeo = this.geo(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2).translate(0.44 * W, 0, -0.05 * H));
    this.wingMat = this.mat(
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: this.wingTex.tex }, uA: { value: 0 }, uTime: { value: 0 } },
        vertexShader: QUAD_VS,
        fragmentShader: WING_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.wingMat.name = 'rakaeli-wing';
    const wing = (): THREE.Mesh => {
      const m = new THREE.Mesh(wGeo, this.wingMat);
      m.visible = false;
      // Under the coin (4), over the aura (3): the wings grow out from behind the token.
      m.renderOrder = 3.5;
      m.frustumCulled = false;
      m.raycast = () => undefined;
      return m;
    };
    this.wings = [wing(), wing()];

    const dGeo = this.geo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    this.darkMat = this.mat(
      new THREE.ShaderMaterial({
        uniforms: { uK: { value: 0 }, uSeed: { value: 0 }, uSize: { value: 1 } },
        vertexShader: QUAD_VS,
        fragmentShader: DARK_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.darkMat.name = 'rakaeli-darkflame';
    this.dark = new THREE.Mesh(dGeo, this.darkMat);
    this.dark.visible = false;
    this.dark.renderOrder = 6;
    this.dark.frustumCulled = false;
    this.dark.raycast = () => undefined;

    this.mats.push(auraMat);
    this.warmAura = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.01, 0.01).rotateX(-Math.PI / 2)), auraMat);
    this.warmAura.visible = false;
    this.group.add(this.feathers, this.wings[0], this.wings[1], this.dark, this.warmAura);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  /** Make every effect mesh visible for a synchronous shader compile (then call with false). */
  setWarm(on: boolean): void {
    for (const o of [this.feathers, this.wings[0], this.wings[1], this.dark, this.warmAura]) o.visible = on;
    if (!on) this.lastT = 0;
  }

  /**
   * Emit one feather at (x, y, z) drifting with (vx, vy, vz) world units / s; `size` = length in
   * cells, `rot` = initial screen-plane angle.
   */
  feather(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, lifeMs: number, tone: FeatherTone, rot: number, spin: number, now: number): void {
    const i = this.nextSlot;
    this.nextSlot = (i + 1) % FEATHER_N;
    const o = i * 12;
    const s = this.fs;
    if (s[o + 10] <= 0) this.alive++;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = z;
    s[o + 3] = vx;
    s[o + 4] = vy;
    s[o + 5] = vz;
    s[o + 6] = rot;
    s[o + 7] = spin;
    s[o + 8] = size;
    s[o + 9] = now;
    s[o + 10] = lifeMs;
    s[o + 11] = rot * 3.1;
    this.fTone.setX(i, tone);
    this.fTone.needsUpdate = true;
    this.feathers.visible = true;
  }

  /** Radial burst of `n` feathers around (x, z). */
  featherBurst(x: number, y: number, z: number, n: number, speed: number, size: number, lifeMs: number, tone: FeatherTone, now: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.sin(now * 0.013 + i * 2.3) * 0.4;
      const v = speed * (0.7 + 0.3 * Math.sin(i * 5.1 + now));
      this.feather(x + Math.cos(a) * 0.15, y, z + Math.sin(a) * 0.15, Math.cos(a) * v, 0.2, Math.sin(a) * v, size * (0.8 + 0.3 * ((i * 7) % 3) / 2), lifeMs, tone, -a + Math.PI / 2, (i % 2 ? 1 : -1) * (1.5 + (i % 3)), now);
    }
  }

  /** Dark-flame impact at (x, z), `radius` in world units. */
  darkFlame(x: number, y: number, z: number, radius: number, durMs: number, now: number): void {
    this.darkT0 = now;
    this.darkDur = durMs;
    this.dark.position.set(x, y, z);
    this.dark.scale.set(radius * 2, 1, radius * 2);
    this.darkMat.uniforms.uSeed.value = (now % 97) * 0.37;
    this.darkMat.uniforms.uSize.value = radius > 0.8 ? 1 : 0.7;
    this.darkMat.uniforms.uK.value = 0;
    this.dark.visible = true;
  }

  /**
   * Wings around the token at (x, z): `k` = unfold (0 folded down along the coin .. 1 spread wide),
   * `a` = opacity (0 hides them).
   */
  setWings(x: number, y: number, z: number, k: number, a: number, now: number): void {
    const on = a > 0.003;
    this.wings[0].visible = on;
    this.wings[1].visible = on;
    if (!on) return;
    this.wingMat.uniforms.uA.value = a;
    this.wingMat.uniforms.uTime.value = now / 1000;
    const s = 0.45 + 0.6 * k;
    const ang = -1.35 * (1 - k);
    for (let side = 0; side < 2; side++) {
      const m = this.wings[side];
      const sgn = side === 0 ? 1 : -1;
      m.position.set(x + sgn * 0.17, y, z + 0.04);
      m.rotation.set(0, ang * sgn, 0);
      m.scale.set(s * sgn, 1, s);
    }
  }

  /** Advance everything; true while anything is visible. */
  update(now: number): boolean {
    const dt = this.lastT > 0 ? Math.min(0.05, Math.max(0, (now - this.lastT) / 1000)) : 1 / 60;
    this.lastT = now;
    let active = false;
    if (this.alive > 0) {
      active = true;
      const s = this.fs;
      const drag = Math.pow(0.12, dt);
      let alive = 0;
      for (let i = 0; i < FEATHER_N; i++) {
        const o = i * 12;
        const life = s[o + 10];
        if (life <= 0) continue;
        const k = (now - s[o + 9]) / life;
        if (k >= 1) {
          s[o + 10] = 0;
          this.tmpM.makeScale(0, 0, 0);
          this.feathers.setMatrixAt(i, this.tmpM);
          this.fAlpha.setX(i, 0);
          continue;
        }
        alive++;
        s[o + 3] *= drag;
        s[o + 5] *= drag;
        s[o + 4] = s[o + 4] * drag - 0.6 * dt;
        s[o] += s[o + 3] * dt;
        s[o + 1] = Math.max(0.12, s[o + 1] + s[o + 4] * dt);
        s[o + 2] += s[o + 5] * dt;
        s[o + 6] += s[o + 7] * dt;
        s[o + 7] *= Math.pow(0.5, dt);
        const kk = Math.max(0, k);
        // Flutter: the feather narrows as it rocks (a flat card seen from above).
        const flut = 0.55 + 0.45 * Math.abs(Math.cos(s[o + 11] + kk * 9));
        const size = s[o + 8] * (1 - 0.25 * kk);
        this.tmpQ.setFromAxisAngle(this.up, s[o + 6]);
        this.tmpP.set(s[o] + Math.sin(kk * 7 + s[o + 11]) * 0.05, s[o + 1], s[o + 2]);
        this.tmpS.set(size * 0.5 * flut, 1, size * 0.5);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
        this.feathers.setMatrixAt(i, this.tmpM);
        this.fAlpha.setX(i, Math.min(1, kk * 8) * (1 - kk * kk));
      }
      this.alive = alive;
      this.feathers.instanceMatrix.needsUpdate = true;
      this.fAlpha.needsUpdate = true;
      if (alive === 0) this.feathers.visible = false;
    }
    if (this.darkT0 >= 0) {
      const k = (now - this.darkT0) / this.darkDur;
      if (k >= 1) {
        this.darkT0 = -1;
        this.dark.visible = false;
      } else {
        active = true;
        this.darkMat.uniforms.uK.value = Math.max(0, k);
      }
    }
    if (this.wings[0].visible) active = true;
    return active;
  }

  /** Hide everything now. */
  clear(): void {
    const s = this.fs;
    for (let i = 0; i < FEATHER_N; i++) s[i * 12 + 10] = 0;
    this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < FEATHER_N; i++) this.feathers.setMatrixAt(i, this.tmpM);
    this.feathers.instanceMatrix.needsUpdate = true;
    this.alive = 0;
    this.feathers.visible = false;
    this.wings[0].visible = false;
    this.wings[1].visible = false;
    this.darkT0 = -1;
    this.dark.visible = false;
  }

  restore(): void {
    this.featherTex.restore();
    this.wingTex.restore();
  }

  dispose(): void {
    this.clear();
    this.feathers.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.featherTex.dispose();
    this.wingTex.dispose();
    this.group.clear();
  }
}
