/** Helpers shared by the WebGL and Canvas2D board views. */
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import type { CharacterId, Level, Move, Piece, PlayerId, Pos } from '../engine/types';
import type { BoardHighlights } from './types';
import {
  ANIM,
  BACKDROP,
  BOARD_COLORS,
  HOME_TINT_STRENGTH,
  LAST_MOVE_TINT_STRENGTH,
  TEAM_COLORS,
  ZONE_TINT_STRENGTH,
} from './palette';

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgbToCss(c: RGB, alpha = 1): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export const posKey = (p: Pos): number => p.r * BOARD_SIZE + p.c;

export function inBoard(p: Pos): boolean {
  return p.r >= 0 && p.r < BOARD_SIZE && p.c >= 0 && p.c < BOARD_SIZE;
}

/** Board-wide forward direction in rows for a player. */
export const forwardDir = (owner: PlayerId): 1 | -1 => (owner === 0 ? 1 : -1);

/** Which team's home zone a row belongs to, if any. */
export function homeOwner(r: number): PlayerId | null {
  if (r < ZONE_DEPTH) return 0;
  if (r >= BOARD_SIZE - ZONE_DEPTH) return 1;
  return null;
}

const RGB_LIGHT = hexToRgb(BOARD_COLORS.tileLight);
const RGB_DARK = hexToRgb(BOARD_COLORS.tileDark);
const RGB_LAST = hexToRgb(BOARD_COLORS.lastMove);
const RGB_SEL = hexToRgb(BOARD_COLORS.selectedTint);
const RGB_CAP = hexToRgb(BOARD_COLORS.captureTint);
const RGB_ENEMY_SEL = hexToRgb(BOARD_COLORS.enemySelectedTint);
const RGB_ENEMY_MOVE = hexToRgb(BOARD_COLORS.enemyMoveTint);
const RGB_TEAM_ZONE: Record<PlayerId, RGB> = {
  0: hexToRgb(TEAM_COLORS[0].zone),
  1: hexToRgb(TEAM_COLORS[1].zone),
};
const RGB_TEAM_GLOW: Record<PlayerId, RGB> = {
  0: hexToRgb(TEAM_COLORS[0].glow),
  1: hexToRgb(TEAM_COLORS[1].glow),
};

/** Precomputed lookup sets for a highlight state. */
export interface HighlightIndex {
  selected: number;
  moves: Set<number>;
  captures: Set<number>;
  last: Set<number>;
  zone: [number, number] | null;
  /** Reach preview of an enemy piece (red markers) instead of the player's own piece. */
  enemy: boolean;
}

export function indexHighlights(h: BoardHighlights): HighlightIndex {
  const last = new Set<number>();
  if (h.lastMove) {
    last.add(posKey(h.lastMove.from));
    last.add(posKey(h.lastMove.to));
  }
  let zone: [number, number] | null = null;
  if (h.zoneRows) {
    const a = Math.min(h.zoneRows[0], h.zoneRows[1]);
    const b = Math.max(h.zoneRows[0], h.zoneRows[1]);
    zone = [a, b];
  }
  return {
    selected: h.selected ? posKey(h.selected) : -1,
    moves: new Set((h.moves ?? []).map(posKey)),
    captures: new Set((h.captures ?? []).map(posKey)),
    last,
    zone,
    enemy: h.tone === 'enemy',
  };
}

/** Team whose tint is used for a highlighted zone range (falls back to Blue). */
function zoneTeam(zone: [number, number]): PlayerId {
  return zone[0] >= BOARD_SIZE / 2 ? 1 : 0;
}

/** Final sRGB (0..1) color of a tile, combining base two-tone, home tint and highlights. */
export function tileRgb(r: number, c: number, hi: HighlightIndex): RGB {
  let col: RGB = (r + c) % 2 === 0 ? RGB_DARK : RGB_LIGHT;
  const home = homeOwner(r);
  if (home !== null) {
    // Strongest at the back rank, fading towards the zone edge line.
    const depth = home === 0 ? r : BOARD_SIZE - 1 - r;
    col = mixRgb(col, RGB_TEAM_ZONE[home], HOME_TINT_STRENGTH * (1.15 - 0.2 * depth));
  }
  if (hi.zone && r >= hi.zone[0] && r <= hi.zone[1]) {
    const t = zoneTeam(hi.zone);
    col = mixRgb(col, mixRgb(RGB_TEAM_GLOW[t], RGB_TEAM_ZONE[t], 0.5), ZONE_TINT_STRENGTH);
  }
  const k = r * BOARD_SIZE + c;
  if (hi.last.has(k)) col = mixRgb(col, RGB_LAST, LAST_MOVE_TINT_STRENGTH);
  if (hi.enemy && hi.moves.has(k)) col = mixRgb(col, RGB_ENEMY_MOVE, 0.42);
  if (hi.captures.has(k)) col = mixRgb(col, RGB_CAP, 0.85);
  if (hi.selected === k) col = mixRgb(col, hi.enemy ? RGB_ENEMY_SEL : RGB_SEL, 0.9);
  return col;
}

/** Face illustration (round head-and-shoulders crop) of a character level, relative to the page. */
export function faceUrl(character: CharacterId, level: Level): string {
  return `./chars/${character}-lv${level}-face.jpg`;
}

/** True when the OS asks for reduced motion (safe outside browsers). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function moveDistance(m: Move): number {
  return Math.hypot(m.to.r - m.from.r, m.to.c - m.from.c);
}

export function slideDuration(m: Move): number {
  return Math.min(ANIM.slideMax, ANIM.slideMin + moveDistance(m) * 12);
}

/** Shallow equality check used to decide whether a piece's visual must be rebuilt. */
export function sameLook(a: Piece, b: Piece): boolean {
  return a.owner === b.owner && a.character === b.character && a.level === b.level;
}

/** Simple container size read that never returns 0 (avoids NaN aspect). */
export function containerSize(el: HTMLElement): { w: number; h: number } {
  const w = Math.max(1, Math.floor(el.clientWidth));
  const h = Math.max(1, Math.floor(el.clientHeight));
  return { w, h };
}

/** Deterministic PRNG (mulberry32) so procedural textures look identical on every device. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pulse 0..1 with a given period (ms). */
export function pulse01(now: number, periodMs: number): number {
  return 0.5 + 0.5 * Math.sin((now / periodMs) * Math.PI * 2);
}

/** Damped camera micro-shake offset in px for k in 0..1 (axis 0 = x, 1 = y). */
export function shakeOffset(k: number, axis: 0 | 1): number {
  if (k <= 0 || k >= 1) return 0;
  const decay = 1 - k;
  const phase = k * Math.PI * 2 * 3;
  return ANIM.shakePx * decay * (axis === 0 ? Math.sin(phase) : Math.cos(phase * 1.3 + 0.7));
}

/**
 * Paint the arena backdrop (dark radial gradient + faint team glows: Red at the top, Blue at
 * the bottom, + fine grain against banding) into a canvas context of size w x h.
 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, seed = 7): void {
  const g = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, Math.hypot(w, h) * 0.55);
  g.addColorStop(0, BACKDROP.center);
  g.addColorStop(1, BACKDROP.edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const glow = (color: string, cy: number): void => {
    const rgb = hexToRgb(color);
    const rg = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.62);
    rg.addColorStop(0, rgbToCss(rgb, BACKDROP.teamGlow));
    rg.addColorStop(1, rgbToCss(rgb, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  };
  glow(TEAM_COLORS[1].zone, -h * 0.02); // far side (Red) at the top of the screen
  glow(TEAM_COLORS[0].zone, h * 1.02); // near side (Blue) at the bottom
  // Faint arena rings (a hint of a summoning circle behind the board).
  ctx.strokeStyle = 'rgba(140,170,255,0.07)';
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.004);
  for (const f of [0.34, 0.5, 0.68]) {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * f, h * f * 0.78, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Vignette.
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  // Grain.
  const rnd = makeRng(seed);
  const n = Math.round((w * h) / 90);
  for (let i = 0; i < n; i++) {
    const a = 0.025 + rnd() * 0.035;
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.6})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
}
