/** Helpers shared by the WebGL and Canvas2D board views. */
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import type { Move, Piece, PlayerId, Pos } from '../engine/types';
import type { BoardHighlights } from './types';
import {
  ANIM,
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
const RGB_TEAM_CONTAINER: Record<PlayerId, RGB> = {
  0: hexToRgb(TEAM_COLORS[0].container),
  1: hexToRgb(TEAM_COLORS[1].container),
};
const RGB_TEAM_LIGHT: Record<PlayerId, RGB> = {
  0: hexToRgb(TEAM_COLORS[0].light),
  1: hexToRgb(TEAM_COLORS[1].light),
};

/** Precomputed lookup sets for a highlight state. */
export interface HighlightIndex {
  selected: number;
  moves: Set<number>;
  captures: Set<number>;
  last: Set<number>;
  zone: [number, number] | null;
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
  if (home !== null) col = mixRgb(col, RGB_TEAM_CONTAINER[home], HOME_TINT_STRENGTH);
  if (hi.zone && r >= hi.zone[0] && r <= hi.zone[1]) {
    const t = zoneTeam(hi.zone);
    col = mixRgb(col, mixRgb(RGB_TEAM_CONTAINER[t], RGB_TEAM_LIGHT[t], 0.25), ZONE_TINT_STRENGTH);
  }
  const k = r * BOARD_SIZE + c;
  if (hi.last.has(k)) col = mixRgb(col, RGB_LAST, LAST_MOVE_TINT_STRENGTH);
  if (hi.captures.has(k)) col = mixRgb(col, RGB_CAP, 0.85);
  if (hi.selected === k) col = mixRgb(col, RGB_SEL, 0.9);
  return col;
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
