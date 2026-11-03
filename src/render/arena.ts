/**
 * "Dark Arena" board look (docs/design/dark-arena.md) shared by the WebGL board (as canvas
 * textures + the tile shader in textures.ts) and the Canvas2D fallback (painted straight into its
 * static board layer / cached marker sprites):
 *  - frame: dark iron frame with a light top-left edge, a darker bottom lip, one thin gold trim
 *    with small gold corner studs, and a soft outer shadow onto the page's dark backdrop;
 *  - field well: the near-black bed seen between the tiles, shadowed under the frame's inner edge;
 *  - tiles: dark slate / obsidian tiles with a raised top face (lighter toward the top-left), a
 *    thin light top-left bevel and a darker bottom-right edge / front lip (TILE_* constants,
 *    mirrored by the WebGL tile shader);
 *  - markers: luminous glow dots (own reach ice-cyan, enemy reach red), a glowing selection frame
 *    and a glowing capture ring. They are painted once into textures / sprites and blended
 *    additively (dots, selection) or normally (capture ring, which sits over a coin).
 * One light from the top-left; everything is painted in raw canvas pixels from a cell size `s`
 * and the pixel position (ox, oy) of the field's top-left corner (col 0, row 11).
 * Pure Canvas2D: no three.js, so the 2D fallback stays light.
 */
import { BOARD_SIZE } from '../engine/types';
import { hexToRgb, makeRng, mixRgb, rgbToCss } from './common';
import type { RGB } from './common';
import { ARENA } from './palette';

/** Iron frame width around the 12x12 field (cells). */
export const FRAME_WIDTH = 0.42;
/** Outer corner radius of the frame (cells). */
const FRAME_RADIUS = 0.26;
/** Depth of the dark lip visible under the frame's bottom edge (cells, screen-down). */
const FRAME_LIP = 0.1;
/** Soft outer shadow of the frame onto the page (cells). */
const FRAME_SHADOW = { dy: 0.12, blur: 0.34, alpha: 0.7 } as const;
/** Gold trim: inset from the frame's outer edge and line width (cells). */
const TRIM_INSET = 0.13;
const TRIM_W = 0.032;
/** Field well reveal around the tiles (cells). */
const WELL = 0.05;
/**
 * Extents of everything the frame paints, in cells outside the 12x12 field (the WebGL board sizes
 * its frame plane from these; both views fit the camera / layout to FRAME_FIT).
 */
export const FRAME_EXTENT = {
  side: FRAME_WIDTH + FRAME_SHADOW.blur,
  top: FRAME_WIDTH + FRAME_SHADOW.blur * 0.8,
  bottom: FRAME_WIDTH + FRAME_LIP + FRAME_SHADOW.dy + FRAME_SHADOW.blur,
} as const;
/** What the views fit into the viewport: the frame and its lip plus a little of the shadow. */
export const FRAME_FIT = {
  side: FRAME_WIDTH + 0.14,
  top: FRAME_WIDTH + 0.1,
  bottom: FRAME_WIDTH + FRAME_LIP + 0.16,
} as const;

/**
 * Tile shape (fractions of a cell, screen space y down): the tile fills [TILE_INSET, 1-TILE_INSET],
 * its top face is lifted by TILE_LIP (front lip visible at the bottom) and TILE_LIP_X (right).
 */
export const TILE_INSET = 0.035;
export const TILE_RADIUS = 0.085;
export const TILE_LIP = 0.05;
export const TILE_LIP_X = 0.012;
/** Bevel: light band width on the top-left of the top face, dark band on the bottom-right. */
export const TILE_BEVEL = 0.03;
/** Lip / dark edge shading (multipliers on the tile colour, sRGB) and the bevel highlight. */
export const TILE_LIP_SHADE = 0.52;
export const TILE_EDGE_SHADE = 0.8;
export const TILE_HIGHLIGHT = 0.13;
/** Top face light falloff: brighter top-left, darker bottom-right (+- this fraction). */
export const TILE_FACE_GRAD = 0.07;

const IRON = hexToRgb(ARENA.iron);
const IRON_TOP = hexToRgb(ARENA.ironTop);
const IRON_LIP = hexToRgb(ARENA.ironLip);
const NIGHT0 = hexToRgb(ARENA.night0);
const GOLD = hexToRgb(ARENA.gold);
const GOLD_DEEP = hexToRgb(ARENA.goldDeep);
const GOLD_LIP = hexToRgb(ARENA.goldLip);
const WHITE: RGB = [1, 1, 1];

export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  roundRectSub(g, x, y, w, h, r);
}

/** Rounded rect sub-path (no beginPath); `ccw` reverses the winding (to cut holes). */
function roundRectSub(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, ccw = false): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!ccw) {
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
  } else {
    g.moveTo(x + rr, y);
    g.arcTo(x, y, x, y + h, rr);
    g.arcTo(x, y + h, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x + w, y, rr);
    g.arcTo(x + w, y, x, y, rr);
  }
  g.closePath();
}

/** Frame (shadow, lip, iron, gold trim, field well). `s` = px per cell, (ox, oy) = field top-left px. */
export function paintFrame(g: CanvasRenderingContext2D, s: number, ox: number, oy: number): void {
  const n = BOARD_SIZE;
  const F = FRAME_WIDTH;
  const x0 = ox - F * s;
  const y0 = oy - F * s;
  const w = (n + F * 2) * s;
  const h = (n + F * 2) * s;
  const R = FRAME_RADIUS * s;
  const lip = FRAME_LIP * s;
  const px = Math.max(1, s * 0.03);

  // 1. Soft outer shadow (cast by the whole block, lip included) so the board floats.
  g.save();
  g.shadowColor = rgbToCss(NIGHT0, FRAME_SHADOW.alpha);
  g.shadowBlur = FRAME_SHADOW.blur * s;
  g.shadowOffsetY = FRAME_SHADOW.dy * s;
  g.fillStyle = rgbToCss(IRON_LIP);
  roundRectPath(g, x0, y0 + lip, w, h, R);
  g.fill();
  g.restore();

  // 2. Lip: the frame's front face, darkening toward the ground.
  const lg = g.createLinearGradient(0, y0 + h - R, 0, y0 + h + lip);
  lg.addColorStop(0, rgbToCss(mixRgb(IRON, IRON_LIP, 0.55)));
  lg.addColorStop(1, rgbToCss(IRON_LIP));
  g.fillStyle = lg;
  roundRectPath(g, x0, y0 + lip, w, h, R);
  g.fill();

  // 3. Frame top: dark iron, lit from the top-left.
  const fg = g.createLinearGradient(x0, y0, x0 + w * 0.4, y0 + h);
  fg.addColorStop(0, rgbToCss(IRON_TOP));
  fg.addColorStop(0.5, rgbToCss(IRON));
  fg.addColorStop(1, rgbToCss(mixRgb(IRON, IRON_LIP, 0.35)));
  g.fillStyle = fg;
  roundRectPath(g, x0, y0, w, h, R);
  g.fill();

  g.save();
  roundRectPath(g, x0, y0, w, h, R);
  g.clip();
  // Faint large-scale mottling (forged iron, very low contrast).
  const rnd = makeRng(29);
  for (let i = 0; i < 40; i++) {
    const side = i % 4;
    const t = rnd();
    const d = rnd() * F;
    const cx = side === 0 ? -F + d : side === 1 ? n + F - d : -F + t * (n + 2 * F);
    const cy = side === 2 ? -F + d : side === 3 ? n + F - d : -F + t * (n + 2 * F);
    const rr = (0.2 + rnd() * 0.4) * s;
    const light = rnd() < 0.45;
    const rg = g.createRadialGradient(ox + cx * s, oy + cy * s, 0, ox + cx * s, oy + cy * s, rr);
    rg.addColorStop(0, light ? rgbToCss(IRON_TOP, 0.35) : rgbToCss(IRON_LIP, 0.3));
    rg.addColorStop(1, rgbToCss(IRON, 0));
    g.fillStyle = rg;
    g.fillRect(ox + cx * s - rr, oy + cy * s - rr, rr * 2, rr * 2);
  }
  // Bevel: a thin light edge along the top-left, a darker band along the bottom-right.
  const bw = Math.max(1, s * 0.035);
  const bevel = (dx: number, dy: number, color: string, lw: number): void => {
    g.strokeStyle = color;
    g.lineWidth = lw * 2;
    roundRectPath(g, x0 + dx, y0 + dy, w, h, R);
    g.stroke();
  };
  bevel(bw * 0.8, bw * 0.8, rgbToCss(mixRgb(IRON_TOP, WHITE, 0.25), 0.55), bw);
  bevel(-bw, -bw, rgbToCss(IRON_LIP, 0.6), bw * 1.4);
  g.restore();

  // 4. Gold trim: a thin gilded line inset into the frame (gold lip under it, light gold on top).
  const ti = TRIM_INSET * s;
  const tw = Math.max(1, TRIM_W * s);
  const tr = Math.max(0, R - ti);
  g.lineWidth = tw;
  g.strokeStyle = rgbToCss(GOLD_LIP, 0.9);
  roundRectPath(g, x0 + ti, y0 + ti + tw * 0.6, w - ti * 2, h - ti * 2, tr);
  g.stroke();
  const gg = g.createLinearGradient(0, y0, 0, y0 + h);
  gg.addColorStop(0, rgbToCss(mixRgb(GOLD, WHITE, 0.2)));
  gg.addColorStop(0.5, rgbToCss(GOLD));
  gg.addColorStop(1, rgbToCss(GOLD_DEEP));
  g.strokeStyle = gg;
  roundRectPath(g, x0 + ti, y0 + ti, w - ti * 2, h - ti * 2, tr);
  g.stroke();
  // Small gold studs on the trim's corners and the middle of each side.
  const stud = (cx: number, cy: number, r: number): void => {
    g.fillStyle = rgbToCss(GOLD_LIP);
    g.beginPath();
    g.arc(cx, cy + r * 0.35, r, 0, Math.PI * 2);
    g.fill();
    const sg = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    sg.addColorStop(0, rgbToCss(mixRgb(GOLD, WHITE, 0.45)));
    sg.addColorStop(0.55, rgbToCss(GOLD));
    sg.addColorStop(1, rgbToCss(GOLD_DEEP));
    g.fillStyle = sg;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  };
  const sr = Math.max(1.5, s * 0.075);
  const half = F / 2;
  for (const [u, v] of [
    [-half, -half],
    [n + half, -half],
    [-half, n + half],
    [n + half, n + half],
  ]) {
    stud(ox + u * s, oy + v * s, sr);
  }

  // 5. Field well: the near-black bed between the tiles, shadowed under the frame's inner edge.
  const wx = ox - WELL * s;
  const wy = oy - WELL * s;
  const ww = (n + WELL * 2) * s;
  const wr = s * 0.12;
  g.fillStyle = ARENA.bed;
  roundRectPath(g, wx, wy, ww, ww, wr);
  g.fill();
  // Well rim: dark on the top-left (shadowed), a faint light catch-line on the bottom-right.
  const rim = g.createLinearGradient(wx, wy, wx + ww, wy + ww);
  rim.addColorStop(0, rgbToCss(NIGHT0, 0.9));
  rim.addColorStop(0.55, rgbToCss(NIGHT0, 0.5));
  rim.addColorStop(0.7, rgbToCss(IRON_TOP, 0.35));
  rim.addColorStop(1, rgbToCss(mixRgb(IRON_TOP, WHITE, 0.2), 0.8));
  g.strokeStyle = rim;
  g.lineWidth = px * 1.2;
  roundRectPath(g, wx - px * 0.5, wy - px * 0.5, ww + px, ww + px, wr + px * 0.5);
  g.stroke();
}

/**
 * Over the tiles: soft ambient occlusion where the field meets the frame (stronger on the
 * top-left, the side the frame shadows). Exactly the 12x12 field.
 */
export function paintFieldOverlay(g: CanvasRenderingContext2D, s: number, ox: number, oy: number): void {
  const size = BOARD_SIZE * s;
  g.save();
  g.beginPath();
  g.rect(ox, oy, size, size);
  g.clip();
  const ao = (blur: number, dx: number, dy: number, alpha: number): void => {
    g.shadowColor = rgbToCss(NIGHT0, alpha);
    g.shadowBlur = blur * s;
    g.shadowOffsetX = dx * s;
    g.shadowOffsetY = dy * s;
    g.fillStyle = '#000';
    g.beginPath();
    g.rect(ox - s * 4, oy - s * 4, size + s * 8, size + s * 8);
    g.rect(ox + size, oy, -size, size); // opposite winding: a frame-shaped hole
    g.fill('nonzero');
  };
  ao(0.5, 0.08, 0.14, 0.75);
  ao(0.14, 0.0, 0.0, 0.5);
  g.restore();
}

/** Darken / lighten an sRGB colour (0..1) toward black / white. */
function shade(c: RGB, k: number): RGB {
  return k <= 1 ? [c[0] * k, c[1] * k, c[2] * k] : mixRgb(c, WHITE, k - 1);
}

/** Canvas path of a tile's whole shape (top face + lip) at cell origin (x, y), cell size s. */
export function tileOuterPath(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const i = TILE_INSET * s;
  roundRectPath(g, x + i, y + i, s - i * 2, s - i * 2, TILE_RADIUS * s);
}

function tileTopRect(x: number, y: number, s: number): [number, number, number, number] {
  const i = TILE_INSET * s;
  return [x + i, y + i, s - i * 2 - TILE_LIP_X * s, s - i * 2 - TILE_LIP * s];
}

/** Paint one raised slate tile of colour `c` (sRGB 0..1) at cell origin (x, y), cell size s. */
export function paintTile(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: RGB): void {
  const r = TILE_RADIUS * s;
  // Whole tile in the lip tone (front lip shows below / right of the top face).
  g.fillStyle = rgbToCss(shade(c, TILE_LIP_SHADE));
  tileOuterPath(g, x, y, s);
  g.fill();
  // Top face: lighter toward the top-left (one light source).
  const [tx, ty, tw, th] = tileTopRect(x, y, s);
  const fg = g.createLinearGradient(tx, ty, tx + tw, ty + th);
  fg.addColorStop(0, rgbToCss(shade(c, 1 + TILE_FACE_GRAD)));
  fg.addColorStop(1, rgbToCss(shade(c, 1 - TILE_FACE_GRAD)));
  g.fillStyle = fg;
  roundRectPath(g, tx, ty, tw, th, r * 0.92);
  g.fill();
  // Bevel bands inside the top face: light top-left, darker bottom-right.
  g.save();
  roundRectPath(g, tx, ty, tw, th, r * 0.92);
  g.clip();
  const b = TILE_BEVEL * s;
  g.lineWidth = b * 2;
  g.strokeStyle = rgbToCss(WHITE, TILE_HIGHLIGHT);
  roundRectPath(g, tx + b, ty + b, tw, th, r * 0.92);
  g.stroke();
  g.strokeStyle = `rgba(0,0,0,${1 - TILE_EDGE_SHADE})`;
  roundRectPath(g, tx - b * 0.8, ty - b * 0.8, tw, th, r * 0.92);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- markers (sprites / textures)

/**
 * Luminous move-target dot: a white-hot core fading into a soft halo of `color` (sRGB 0..1).
 * Blend additively. (x, y) = centre, R = halo radius (px). Mirrors the pre-v4 dot texture.
 */
export function paintGlowDot(g: CanvasRenderingContext2D, x: number, y: number, R: number, color: RGB): void {
  const core = mixRgb(color, WHITE, 0.55);
  const gr = g.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, rgbToCss(mixRgb(core, WHITE, 0.4), 1));
  gr.addColorStop(0.22, rgbToCss(core, 0.98));
  gr.addColorStop(0.31, rgbToCss(color, 0.88));
  gr.addColorStop(0.4, rgbToCss(color, 0.42));
  gr.addColorStop(0.62, rgbToCss(color, 0.13));
  gr.addColorStop(1, rgbToCss(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - R, y - R, R * 2, R * 2);
}

/**
 * Selection frame: a glowing rounded square hugging the tile (soft wide glow, bright line, white-hot
 * core). Blend additively. Centred at (x, y), cell size s (px). Needs about 0.2 s of margin.
 */
export function paintSelectGlow(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: RGB): void {
  const half = s * 0.455;
  const r = s * 0.15;
  const path = (): void => roundRectPath(g, x - half, y - half, half * 2, half * 2, r);
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = rgbToCss(color, 0.22);
  g.lineWidth = s * 0.17;
  path();
  g.stroke();
  g.shadowColor = rgbToCss(color, 1);
  g.shadowBlur = s * 0.12;
  g.strokeStyle = rgbToCss(color, 0.95);
  g.lineWidth = s * 0.055;
  path();
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = rgbToCss(mixRgb(color, WHITE, 0.6), 0.95);
  g.lineWidth = s * 0.02;
  path();
  g.stroke();
  g.restore();
}

/**
 * Capture target: a glowing red ring around the threatened coin (soft halo both sides, solid band,
 * hot core line). Normal blending (it sits over the coin). Centred at (x, y), cell size s (px).
 */
export function paintCaptureRing(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: RGB): void {
  const rr = s * 0.47;
  const ring = (lw: number, style: string): void => {
    g.lineWidth = lw;
    g.strokeStyle = style;
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.stroke();
  };
  g.save();
  ring(s * 0.22, rgbToCss(color, 0.14));
  ring(s * 0.13, rgbToCss(color, 0.26));
  g.shadowColor = rgbToCss(color, 1);
  g.shadowBlur = s * 0.1;
  ring(s * 0.065, rgbToCss(color, 1));
  g.shadowBlur = 0;
  ring(s * 0.024, rgbToCss(mixRgb(color, WHITE, 0.55), 1));
  g.restore();
}

/** Marker sprite sizes (fractions of a cell): the canvas each painter above needs. */
export const MARKER_QUAD = { dot: 0.95, select: 1.3, capture: 1.3 } as const;
