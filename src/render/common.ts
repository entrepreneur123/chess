/** Helpers shared by the WebGL and Canvas2D board views. */
import { BOARD_SIZE, ZONE_DEPTH, stormCols, stormRows } from '../engine/types';
import type { CharacterId, Level, Move, Piece, PlayerId, Pos } from '../engine/types';
import { screenArrow, showsDirection } from '../engine/rules';
import type { BoardHighlights } from './types';
import {
  ANIM,
  BOARD_COLORS,
  LAST_MOVE_TINT_STRENGTH,
  TEAM_COLORS,
  ZONE_TINT_STRENGTH,
} from './palette';
import { DEFAULT_BOARD_THEME, homeTintOf, type BoardTheme } from './arenaThemes';

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

/**
 * Forward chevron on a coin's left rim, in top-face units (1 = the coin's top-face radius, 0.385
 * cell): centre radius, half width, height, and the half widths of its light stroke and ink
 * outline. The WebGL token shader (tokens.ts) and Board2DView draw the same mark.
 */
export const ARROW_RIM = 0.86;
export const ARROW_W = 0.17;
export const ARROW_H = 0.13;
export const ARROW_LINE = 0.04;
export const ARROW_INK = 0.08;

/**
 * The coin's forward chevron: +1 up the screen, -1 down, 0 none (`showsDirection`). Goes through
 * the engine's `screenArrow`, like every other direction arrow in the game.
 */
export function arrowSign(p: Pick<Piece, 'owner' | 'dir' | 'character' | 'level' | 'absorbed'>): -1 | 0 | 1 {
  if (!showsDirection(p)) return 0;
  return screenArrow(p) === 'up' ? 1 : -1;
}

/** Board-wide forward direction in rows for a player. */
export const forwardDir = (owner: PlayerId): 1 | -1 => (owner === 0 ? 1 : -1);

/** Which team's home zone a row belongs to, if any. */
export function homeOwner(r: number): PlayerId | null {
  if (r < ZONE_DEPTH) return 0;
  if (r >= BOARD_SIZE - ZONE_DEPTH) return 1;
  return null;
}

const RGB_LAST = hexToRgb(BOARD_COLORS.lastMove);
const RGB_SEL = hexToRgb(BOARD_COLORS.selectedTint);
const RGB_CAP = hexToRgb(BOARD_COLORS.captureTint);
const RGB_ENEMY_SEL = hexToRgb(BOARD_COLORS.enemySelectedTint);
const RGB_ENEMY_MOVE = hexToRgb(BOARD_COLORS.enemyMoveTint);
const RGB_SHOT_OWN = hexToRgb(BOARD_COLORS.shotOwnTint);
const RGB_SHOT_ENEMY = hexToRgb(BOARD_COLORS.shotEnemyTint);
const RGB_FREEZE = hexToRgb(BOARD_COLORS.freezeTint);
const RGB_TEAM_ZONE: Record<PlayerId, RGB> = {
  0: hexToRgb(TEAM_COLORS[0].zone),
  1: hexToRgb(TEAM_COLORS[1].zone),
};
const RGB_TEAM_GLOW: Record<PlayerId, RGB> = {
  0: hexToRgb(TEAM_COLORS[0].glow),
  1: hexToRgb(TEAM_COLORS[1].glow),
};

/** An arena theme's cell base colours (tileRgb). */
export interface TilePalette {
  light: RGB;
  dark: RGB;
  /** Home-zone team tint strength (HOME_TINT_STRENGTH x the theme's multiplier). */
  homeTint: number;
  /** Brightness multiplier of the gold last-move tint (warm / gold fields need a brighter one). */
  lastBoost: number;
}

const tilePalettes = new Map<BoardTheme, TilePalette>();

/** The (cached) cell palette of a board theme. */
export function tilePalette(theme: BoardTheme): TilePalette {
  let p = tilePalettes.get(theme);
  if (!p) {
    p = { light: hexToRgb(theme.tileLight), dark: hexToRgb(theme.tileDark), homeTint: homeTintOf(theme), lastBoost: theme.lastMoveBoost };
    tilePalettes.set(theme, p);
  }
  return p;
}

/** The original hologram navy (moonrune = BOARD_COLORS tileLight / tileDark, HOME_TINT_STRENGTH). */
const DEFAULT_TILES = tilePalette(DEFAULT_BOARD_THEME);

/** Highlight tint strengths over the dark tiles (the glowing markers carry the meaning). */
const ENEMY_MOVE_TINT = 0.4;
const CAPTURE_TINT = 0.75;
/** Venoa's arrow range: lighter than a target, so the lanes read as an area, not as targets. */
const SHOT_RANGE_TINT = 0.6;
const SELECTED_TINT = 0.78;
/** Edge darkening of the field (fraction of brightness lost at the corner tiles). */
const FIELD_VIGNETTE = 0.16;

/** Precomputed lookup sets for a highlight state. */
export interface HighlightIndex {
  selected: number;
  moves: Set<number>;
  captures: Set<number>;
  /** Captures that are Venoa shots (reticle in the tone's shot colour). */
  shots: Set<number>;
  /** Venoa's arrow range (empty squares), tinted in the tone's shot colour. */
  shotRange: Set<number>;
  /** Glacia's freeze reach (targeting), tinted frost blue. */
  freezeRange: Set<number>;
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
    shots: new Set((h.shots ?? []).map(posKey)),
    shotRange: new Set((h.shotRange ?? []).map(posKey)),
    freezeRange: new Set((h.freezeRange ?? []).map(posKey)),
    last,
    zone,
    enemy: h.tone === 'enemy',
  };
}

/** Perceived brightness (sRGB, Rec. 601 weights). */
function luma(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

/** Team whose tint is used for a highlighted zone range (falls back to Blue). */
function zoneTeam(zone: [number, number]): PlayerId {
  return zone[0] >= BOARD_SIZE / 2 ? 1 : 0;
}

/**
 * Final sRGB (0..1) color of a tile, combining base two-tone, home tint and highlights. `pal` = the
 * arena theme's cells (default: the original hologram navy, moonrune).
 */
export function tileRgb(r: number, c: number, hi: HighlightIndex, pal: TilePalette = DEFAULT_TILES): RGB {
  let col: RGB = (r + c) % 2 === 0 ? pal.dark : pal.light;
  const home = homeOwner(r);
  if (home !== null) {
    // Soft team-deep tint, a touch stronger toward the zone edge line (the glow wash and the
    // bright edge line sit there). Red is mixed a little harder: over navy it would turn violet.
    const depth = home === 0 ? r : BOARD_SIZE - 1 - r;
    col = mixRgb(col, RGB_TEAM_ZONE[home], pal.homeTint * (0.8 + 0.12 * depth) * (home === 1 ? 1.2 : 1));
  }
  // Soft field vignette (per tile, so both views and the highlight repaints agree): the centre of
  // the arena is a touch brighter than its corners, never a flat colour over the whole field.
  const dx = (c - (BOARD_SIZE - 1) / 2) / (BOARD_SIZE / 2);
  const dy = (r - (BOARD_SIZE - 1) / 2) / (BOARD_SIZE / 2);
  const v = 1 + FIELD_VIGNETTE * 0.35 - FIELD_VIGNETTE * Math.min(1, (dx * dx + dy * dy) * 0.6);
  col = [clamp01(col[0] * v), clamp01(col[1] * v), clamp01(col[2] * v)];
  if (hi.zone && r >= hi.zone[0] && r <= hi.zone[1]) {
    const t = zoneTeam(hi.zone);
    col = mixRgb(col, mixRgb(RGB_TEAM_GLOW[t], RGB_TEAM_ZONE[t], 0.5), ZONE_TINT_STRENGTH);
  }
  const sq = r * BOARD_SIZE + c;
  if (hi.last.has(sq)) {
    // Warm candle-gold at the tile's own brightness (a plain mix with the blue / red zone tints
    // would cancel out to grey).
    const k = (0.22 + luma(col) * 1.25) * pal.lastBoost;
    col = mixRgb(col, [RGB_LAST[0] * k, RGB_LAST[1] * k, RGB_LAST[2] * k], LAST_MOVE_TINT_STRENGTH);
  }
  if (hi.enemy && hi.moves.has(sq)) col = mixRgb(col, RGB_ENEMY_MOVE, ENEMY_MOVE_TINT);
  if (hi.shotRange.has(sq)) col = mixRgb(col, hi.enemy ? RGB_SHOT_ENEMY : RGB_SHOT_OWN, SHOT_RANGE_TINT);
  if (hi.freezeRange.has(sq)) col = mixRgb(col, RGB_FREEZE, SHOT_RANGE_TINT);
  if (hi.captures.has(sq)) col = mixRgb(col, hi.shots.has(sq) ? (hi.enemy ? RGB_SHOT_ENEMY : RGB_SHOT_OWN) : RGB_CAP, CAPTURE_TINT);
  if (hi.selected === sq) col = mixRgb(col, hi.enemy ? RGB_ENEMY_SEL : RGB_SEL, SELECTED_TINT);
  return col;
}

/** Face illustration (round head-and-shoulders crop) of a character level, relative to the page. */
export function faceUrl(character: CharacterId, level: Level): string {
  return `./chars/${character}-lv${level}-face.jpg`;
}

/** True when the OS asks for reduced motion (safe outside browsers). */
/**
 * Board animations never wait on frames that do not come: when the page is hidden (no
 * requestAnimationFrame at all) or no frame ran for this long, a running move / cast / transform
 * is finished at once at its end state. The game awaits these animations.
 */
export const FRAME_STALL_MS = 500;

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Is square (r, c) inside a storm at step `storm` (both boards)? `stormCols(storm)` columns per side
 * and, from step 3, `stormRows(storm)` rows at the top and bottom (the engine's `inStorm`). `slack`
 * looks that many steps ahead (vanish detection: the next band to be consumed counts too).
 */
export function stormSquare(r: number, c: number, storm: number, slack = 0): boolean {
  const n = storm + slack;
  if (n <= 0) return false;
  const cols = stormCols(n);
  if (c < cols || c >= BOARD_SIZE - cols) return true;
  const rows = stormRows(n);
  return r < rows || r >= BOARD_SIZE - rows;
}

export function moveDistance(m: Move): number {
  return Math.hypot(m.to.r - m.from.r, m.to.c - m.from.c);
}

export function slideDuration(m: Move): number {
  return Math.min(ANIM.slideMax, ANIM.slideMin + moveDistance(m) * 12);
}

/**
 * Picker's hop-through plays as square-by-square hops (both boards): every diagonal Picker move.
 * Only a real Picker hops: an Insaner that absorbed Picker's pattern gets its range as a plain
 * slide, so its diagonal moves animate as normal slides.
 */
export function isHopMove(p: Pick<Piece, 'character'>, m: Move): boolean {
  const dr = Math.abs(m.to.r - m.from.r);
  const dc = Math.abs(m.to.c - m.from.c);
  // Verish's pierce: every move is a straight lane, played square by square (flat, fast).
  if (p.character === 'verish') return dr + dc > 0 && (dr === 0 || dc === 0);
  if (dr === 0 || dr !== dc) return false;
  return p.character === 'picker';
}

/** The squares a hop (or a pierce) passes in order, `to` included (`from` excluded). */
export function hopSquares(m: Move): Pos[] {
  const n = Math.max(Math.abs(m.to.r - m.from.r), Math.abs(m.to.c - m.from.c));
  const sr = Math.sign(m.to.r - m.from.r);
  const sc = Math.sign(m.to.c - m.from.c);
  const out: Pos[] = [];
  for (let k = 1; k <= n; k++) out.push({ r: m.from.r + sr * k, c: m.from.c + sc * k });
  return out;
}

/** Hop timing (ms per hop, landing squash) and arc height (cells); flattened for reduced motion. */
export function hopTiming(reduced: boolean): { stepMs: number; landMs: number; arc: number } {
  return reduced ? { stepMs: 90, landMs: 40, arc: 0.06 } : { stepMs: 230, landMs: 120, arc: 0.42 };
}

/**
 * Per-character step timing of a square-by-square move: Picker's hops arc (`hopTiming`); Verish's
 * pierce is a flat, fast power-boot slide (no arc, no landing squash between squares).
 */
export function hopTimingFor(character: string, reduced: boolean): { stepMs: number; landMs: number; arc: number } {
  if (character === 'verish') return reduced ? { stepMs: 70, landMs: 0, arc: 0 } : { stepMs: 115, landMs: 0, arc: 0 };
  return hopTiming(reduced);
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
 * Venoa's shot lanes as seen from `from`: for each straight direction that has squares in `squares`
 * (her arrow range plus her targets), the farthest of them. Boards sweep an arrow to each end.
 */
export function shotLaneEnds(from: Pos, squares: readonly Pos[]): Pos[] {
  const far = new Map<number, Pos>();
  const dist = new Map<number, number>();
  for (const q of squares) {
    const dr = q.r - from.r;
    const dc = q.c - from.c;
    // Only straight lanes (orthogonal or diagonal) count.
    if ((dr === 0 && dc === 0) || (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc))) continue;
    const key = (Math.sign(dr) + 1) * 3 + (Math.sign(dc) + 1);
    const d = Math.max(Math.abs(dr), Math.abs(dc));
    if (d > (dist.get(key) ?? 0)) {
      dist.set(key, d);
      far.set(key, q);
    }
  }
  return [...far.values()];
}
