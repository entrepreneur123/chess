/**
 * "Bright Arena" board look shared by the WebGL board (as canvas textures + the tile shader in
 * BoardView) and the Canvas2D fallback (painted straight into its static board layer):
 *  - plinth: chunky rounded stone frame (light top bevel, darker lip under it, soft navy drop
 *    shadow onto the page), stone block seams, corner studs and a team gem on the near / far side;
 *  - field well: deeper grass bed seen between the tiles, the frame's inner wall at the top;
 *  - field overlay: soft ambient occlusion where the field meets the frame + a soft cream centre
 *    path between the two halves (no hard lines);
 *  - tiles: rounded grass tiles with a raised top face, a light top-left bevel and a darker
 *    bottom-right edge / front lip (TILE_* constants, mirrored by the WebGL tile shader).
 * One light from the top-left; everything is painted in raw canvas pixels from a cell size `s`
 * and the pixel position (ox, oy) of the field's top-left corner (col 0, row 11).
 * Pure Canvas2D: no three.js, so the 2D fallback stays light.
 */
import { BOARD_SIZE } from '../engine/types';
import type { PlayerId } from '../engine/types';
import { hexToRgb, makeRng, mixRgb, rgbToCss } from './common';
import type { RGB } from './common';
import { ARENA, TEAM_COLORS } from './palette';

/** Stone frame width around the 12x12 field (cells). */
export const PLINTH_FRAME = 0.5;
/** Outer corner radius of the plinth (cells). */
export const PLINTH_RADIUS = 0.44;
/** Depth of the dark lip visible under the frame's front edge (cells, screen-down). */
export const PLINTH_LIP = 0.22;
/** Drop shadow of the plinth onto the page (cells). */
export const PLINTH_SHADOW = { dy: 0.26, blur: 0.42, alpha: 0.42 } as const;
/** Visible inner wall of the frame above the field (cells) and the side reveal of the well. */
const WELL_TOP = 0.11;
const WELL_SIDE = 0.05;
/**
 * Extents of everything the plinth paints, in cells outside the 12x12 field (the WebGL board sizes
 * its plinth plane and camera fit from these).
 */
export const PLINTH_EXTENT = {
  side: PLINTH_FRAME + 0.22,
  top: PLINTH_FRAME + 0.2,
  bottom: PLINTH_FRAME + PLINTH_LIP + PLINTH_SHADOW.dy + PLINTH_SHADOW.blur * 0.9,
} as const;

/**
 * Tile shape (fractions of a cell, screen space y down): the tile fills [TILE_INSET, 1-TILE_INSET],
 * its top face is lifted by TILE_LIP (front lip visible at the bottom) and TILE_LIP_X (right).
 */
export const TILE_INSET = 0.03;
export const TILE_RADIUS = 0.11;
export const TILE_LIP = 0.065;
export const TILE_LIP_X = 0.016;
/** Bevel: light band width on the top-left of the top face, dark band on the bottom-right. */
export const TILE_BEVEL = 0.035;
/** Lip / dark edge shading (multipliers on the tile colour, sRGB). */
export const TILE_LIP_SHADE = 0.74;
export const TILE_EDGE_SHADE = 0.88;
export const TILE_HIGHLIGHT = 0.32;

const NAVY = hexToRgb(ARENA.navy);
const STONE = hexToRgb(ARENA.stone);
const STONE_LIGHT = hexToRgb(ARENA.stoneLight);
const STONE_DEEP = hexToRgb(ARENA.stoneDeep);
const STONE_SHADOW = hexToRgb(ARENA.stoneShadow);
const WHITE: RGB = [1, 1, 1];

export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Plinth (shadow, lip, stone frame, field well). `s` = px per cell, (ox, oy) = field top-left px. */
export function paintPlinth(g: CanvasRenderingContext2D, s: number, ox: number, oy: number): void {
  const n = BOARD_SIZE;
  const F = PLINTH_FRAME;
  const x0 = ox - F * s;
  const y0 = oy - F * s;
  const w = (n + F * 2) * s;
  const h = (n + F * 2) * s;
  const R = PLINTH_RADIUS * s;
  const lip = PLINTH_LIP * s;
  const px = Math.max(1, s * 0.03);

  // 1. Soft navy drop shadow onto the page (cast by the whole block, lip included).
  g.save();
  g.shadowColor = rgbToCss(NAVY, PLINTH_SHADOW.alpha);
  g.shadowBlur = PLINTH_SHADOW.blur * s;
  g.shadowOffsetY = PLINTH_SHADOW.dy * s;
  g.fillStyle = rgbToCss(STONE_SHADOW);
  roundRectPath(g, x0 + s * 0.08, y0 + lip, w - s * 0.16, h, R);
  g.fill();
  g.restore();

  // 2. Lip: the frame's front face, dark stone getting darker toward the ground.
  const lg = g.createLinearGradient(0, y0 + h - R, 0, y0 + h + lip);
  lg.addColorStop(0, rgbToCss(STONE_DEEP));
  lg.addColorStop(1, rgbToCss(STONE_SHADOW));
  g.fillStyle = lg;
  roundRectPath(g, x0, y0 + lip, w, h, R);
  g.fill();
  // Navy keyline around the whole block (top + lip) so the board reads crisply on the sky.
  g.strokeStyle = rgbToCss(NAVY, 0.5);
  g.lineWidth = px * 1.2;
  roundRectPath(g, x0, y0, w, h + lip, R);
  g.stroke();

  // 3. Frame top: warm stone, lighter toward the top (one light from the top-left).
  const fg = g.createLinearGradient(x0, y0, x0 + w * 0.35, y0 + h);
  fg.addColorStop(0, rgbToCss(mixRgb(STONE, STONE_LIGHT, 0.45)));
  fg.addColorStop(0.55, rgbToCss(STONE));
  fg.addColorStop(1, rgbToCss(mixRgb(STONE, STONE_DEEP, 0.22)));
  g.fillStyle = fg;
  roundRectPath(g, x0, y0, w, h, R);
  g.fill();

  g.save();
  roundRectPath(g, x0, y0, w, h, R);
  g.clip();
  // Very soft mottling (large, low contrast: reads as stone, not as noise).
  const rnd = makeRng(41);
  for (let i = 0; i < 46; i++) {
    const side = i % 4;
    const t = rnd();
    const d = rnd() * F;
    const cx = side === 0 ? -F + d : side === 1 ? n + F - d : -F + t * (n + 2 * F);
    const cy = side === 2 ? -F + d : side === 3 ? n + F - d : -F + t * (n + 2 * F);
    const rr = (0.18 + rnd() * 0.35) * s;
    const light = rnd() < 0.5;
    const rg = g.createRadialGradient(ox + cx * s, oy + cy * s, 0, ox + cx * s, oy + cy * s, rr);
    rg.addColorStop(0, light ? rgbToCss(STONE_LIGHT, 0.22) : rgbToCss(STONE_DEEP, 0.16));
    rg.addColorStop(1, rgbToCss(STONE, 0));
    g.fillStyle = rg;
    g.fillRect(ox + cx * s - rr, oy + cy * s - rr, rr * 2, rr * 2);
  }
  // Stone block seams across the frame (dark groove + light catch line on its lower-right side).
  const seam = (ax: number, ay: number, bx: number, by: number, vertical: boolean): void => {
    g.lineWidth = px * 1.3;
    g.strokeStyle = rgbToCss(STONE_DEEP, 0.75);
    g.beginPath();
    g.moveTo(ox + ax * s, oy + ay * s);
    g.lineTo(ox + bx * s, oy + by * s);
    g.stroke();
    const o = px * 1.3;
    g.lineWidth = px;
    g.strokeStyle = rgbToCss(STONE_LIGHT, 0.85);
    g.beginPath();
    g.moveTo(ox + ax * s + (vertical ? o : 0), oy + ay * s + (vertical ? 0 : o));
    g.lineTo(ox + bx * s + (vertical ? o : 0), oy + by * s + (vertical ? 0 : o));
    g.stroke();
  };
  for (const u of [0, 4, 8, n]) {
    seam(u, -F, u, -WELL_TOP, true);
    seam(u, n + WELL_SIDE, u, n + F, true);
    seam(-F, u, -WELL_SIDE, u, false);
    seam(n + WELL_SIDE, u, n + F, u, false);
  }
  // Bevel: a light band along the top-left edges, a darker band along the bottom-right edges.
  const bw = Math.max(1.5, s * 0.07);
  const bevel = (dx: number, dy: number, color: string): void => {
    g.strokeStyle = color;
    g.lineWidth = bw * 2;
    roundRectPath(g, x0 + dx, y0 + dy, w, h, R);
    g.stroke();
  };
  bevel(bw * 0.9, bw * 0.9, rgbToCss(WHITE, 0.5));
  bevel(-bw * 0.7, -bw * 0.7, rgbToCss(STONE_DEEP, 0.55));
  g.restore();

  // Corner studs (round stone bosses on the corner blocks).
  for (const [u, v] of [
    [-F / 2, -F / 2],
    [n + F / 2, -F / 2],
    [-F / 2, n + F / 2],
    [n + F / 2, n + F / 2],
  ]) {
    const cx = ox + u * s + s * 0.01;
    const cy = oy + v * s + s * 0.01;
    const r = s * 0.13;
    g.fillStyle = rgbToCss(STONE_DEEP, 0.9);
    g.beginPath();
    g.arc(cx + px * 0.6, cy + px * 1.6, r, 0, Math.PI * 2);
    g.fill();
    const sg = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    sg.addColorStop(0, rgbToCss(mixRgb(STONE_LIGHT, WHITE, 0.4)));
    sg.addColorStop(1, rgbToCss(STONE));
    g.fillStyle = sg;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }
  // Team gems on the far (Red, top) and near (Blue, bottom) side of the frame.
  paintGem(g, ox + (n / 2) * s, oy - (F / 2 + WELL_TOP * 0.35) * s, s * 0.17, 1);
  paintGem(g, ox + (n / 2) * s, oy + (n + F / 2 + WELL_SIDE * 0.5) * s, s * 0.17, 0);

  // 4. Field well: deeper grass bed, the frame's inner wall visible along the top edge.
  const wx = ox - WELL_SIDE * s;
  const wy = oy - WELL_TOP * s;
  const ww = (n + WELL_SIDE * 2) * s;
  const wh = (n + WELL_TOP + WELL_SIDE) * s;
  const wr = s * 0.16;
  g.save();
  roundRectPath(g, wx, wy, ww, wh, wr);
  g.clip();
  g.fillStyle = ARENA.bed;
  g.fillRect(wx, wy, ww, wh);
  const wall = g.createLinearGradient(0, wy, 0, oy + s * 0.02);
  wall.addColorStop(0, rgbToCss(STONE_SHADOW));
  wall.addColorStop(1, rgbToCss(mixRgb(STONE_SHADOW, NAVY, 0.25)));
  g.fillStyle = wall;
  g.fillRect(wx, wy, ww, oy + s * 0.02 - wy);
  const lw = g.createLinearGradient(wx, 0, ox + s * 0.02, 0);
  lw.addColorStop(0, rgbToCss(mixRgb(STONE_SHADOW, NAVY, 0.15), 0.9));
  lw.addColorStop(1, rgbToCss(STONE_SHADOW, 0));
  g.fillStyle = lw;
  g.fillRect(wx, oy, ox + s * 0.02 - wx, n * s);
  g.restore();
  // Well rim: dark on the top-left (shadowed), light catch-line on the bottom-right.
  const rim = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
  rim.addColorStop(0, rgbToCss(NAVY, 0.45));
  rim.addColorStop(0.5, rgbToCss(NAVY, 0.1));
  rim.addColorStop(0.62, rgbToCss(STONE_LIGHT, 0.4));
  rim.addColorStop(1, rgbToCss(mixRgb(STONE_LIGHT, WHITE, 0.5), 0.95));
  g.strokeStyle = rim;
  g.lineWidth = px * 1.3;
  roundRectPath(g, wx - px * 0.4, wy - px * 0.4, ww + px * 0.8, wh + px * 0.8, wr + px * 0.4);
  g.stroke();
}

/** Small faceted team gem set into the frame. */
function paintGem(g: CanvasRenderingContext2D, x: number, y: number, r: number, owner: PlayerId): void {
  const t = TEAM_COLORS[owner];
  g.save();
  g.translate(x, y);
  // Socket shadow.
  g.fillStyle = rgbToCss(STONE_SHADOW, 0.85);
  g.beginPath();
  g.ellipse(0, r * 0.2, r * 1.75, r * 1.0, 0, 0, Math.PI * 2);
  g.fill();
  // Gem body: a wide hexagon, lit from the top-left.
  const pts: [number, number][] = [
    [-1.45, 0],
    [-0.8, -0.82],
    [0.8, -0.82],
    [1.45, 0],
    [0.8, 0.82],
    [-0.8, 0.82],
  ];
  g.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? g.moveTo(px * r, py * r) : g.lineTo(px * r, py * r)));
  g.closePath();
  const gg = g.createLinearGradient(-r, -r, r, r);
  gg.addColorStop(0, t.light);
  gg.addColorStop(0.5, t.main);
  gg.addColorStop(1, t.dark);
  g.fillStyle = gg;
  g.fill();
  g.lineWidth = Math.max(1, r * 0.2);
  g.strokeStyle = ARENA.navy;
  g.stroke();
  // Facet highlight.
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.moveTo(-1.05 * r, -0.05 * r);
  g.lineTo(-0.6 * r, -0.55 * r);
  g.lineTo(0.35 * r, -0.55 * r);
  g.lineTo(-0.15 * r, -0.05 * r);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * Over the tiles: soft ambient occlusion where the field meets the frame (stronger on the
 * top-left, the side the frame shadows) and the soft cream centre path between the halves.
 */
export function paintFieldOverlay(g: CanvasRenderingContext2D, s: number, ox: number, oy: number): void {
  const n = BOARD_SIZE;
  const size = n * s;
  // Centre path: a soft, worn cream strip across the middle (feathered, no hard edge).
  const mid = oy + (n / 2) * s;
  const ph = s * 0.34;
  const pg = g.createLinearGradient(0, mid - ph, 0, mid + ph);
  const path = hexToRgb(ARENA.path);
  pg.addColorStop(0, rgbToCss(path, 0));
  pg.addColorStop(0.32, rgbToCss(path, 0.1));
  pg.addColorStop(0.44, rgbToCss(path, 0.3));
  pg.addColorStop(0.56, rgbToCss(path, 0.3));
  pg.addColorStop(0.68, rgbToCss(path, 0.1));
  pg.addColorStop(1, rgbToCss(path, 0));
  g.fillStyle = pg;
  g.fillRect(ox, mid - ph, size, ph * 2);
  // Centre circle (very faint): the arena's kick-off spot.
  g.strokeStyle = rgbToCss(path, 0.26);
  g.lineWidth = Math.max(1, s * 0.055);
  g.beginPath();
  g.arc(ox + size / 2, mid, s * 0.95, 0, Math.PI * 2);
  g.stroke();

  // Ambient occlusion: inner shadow of the frame onto the field.
  g.save();
  g.beginPath();
  g.rect(ox, oy, size, size);
  g.clip();
  const ao = (blur: number, dx: number, dy: number, alpha: number): void => {
    g.shadowColor = `rgba(16,48,10,${alpha})`;
    g.shadowBlur = blur * s;
    g.shadowOffsetX = dx * s;
    g.shadowOffsetY = dy * s;
    g.fillStyle = '#000';
    g.beginPath();
    g.rect(ox - s * 4, oy - s * 4, size + s * 8, size + s * 8);
    g.rect(ox + size, oy, -size, size); // opposite winding: a frame-shaped hole
    g.fill('nonzero');
  };
  ao(0.55, 0.1, 0.18, 0.5);
  ao(0.16, 0.0, 0.0, 0.3);
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

/** Paint one raised grass tile of colour `c` (sRGB 0..1) at cell origin (x, y), cell size s. */
export function paintTile(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: RGB): void {
  const r = TILE_RADIUS * s;
  // Whole tile in the lip tone (front lip shows below / right of the top face).
  const lg = g.createLinearGradient(0, y + s * 0.8, 0, y + s);
  lg.addColorStop(0, rgbToCss(shade(c, TILE_LIP_SHADE)));
  lg.addColorStop(1, rgbToCss(shade(c, TILE_LIP_SHADE * 0.88)));
  g.fillStyle = lg;
  tileOuterPath(g, x, y, s);
  g.fill();
  // Top face.
  const [tx, ty, tw, th] = tileTopRect(x, y, s);
  g.fillStyle = rgbToCss(c);
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

/**
 * Selection frame (tint = `color`): a rounded-square band hugging the selected tile, between navy
 * keylines, with a soft drop shadow. Centred at (x, y), cell size s (px).
 */
export function paintSelectFrame(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const half = s * 0.5;
  const bw = s * 0.075;
  const r = s * 0.16;
  const frame = (grow: number): void => {
    g.beginPath();
    roundRectSub(g, x - half - grow, y - half - grow, s + grow * 2, s + grow * 2, r + grow);
    roundRectSub(g, x - half + bw - grow, y - half + bw - grow, s - (bw - grow) * 2, s - (bw - grow) * 2, Math.max(0, r - bw + grow), true);
  };
  g.save();
  g.shadowColor = 'rgba(15,22,48,0.4)';
  g.shadowBlur = s * 0.06;
  g.shadowOffsetY = s * 0.03;
  g.fillStyle = ARENA.navy;
  frame(s * 0.02);
  g.fill();
  g.restore();
  g.fillStyle = color;
  frame(0);
  g.fill();
  // Catch light along the top edge of the band.
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  roundRectSub(g, x - half + r * 0.6, y - half + bw * 0.12, s - r * 1.2, bw * 0.32, bw * 0.16);
  g.fill();
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

/**
 * Capture target mark (tint = `color`): four chunky corner brackets around the tile ("lock-on"),
 * navy keyline + soft shadow, so the target reads even around a same-coloured coin.
 */
export function paintCaptureMark(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const h = s * 0.5;
  const arm = s * 0.3;
  const bw = s * 0.085;
  const corners = (grow: number): void => {
    g.beginPath();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = x + sx * (h + grow);
        const cy = y + sy * (h + grow);
        const ix = -sx;
        const iy = -sy;
        const t = bw + grow * 2;
        const a = arm + grow * 2;
        g.moveTo(cx, cy);
        g.lineTo(cx + ix * a, cy);
        g.lineTo(cx + ix * a, cy + iy * t);
        g.lineTo(cx + ix * t, cy + iy * t);
        g.lineTo(cx + ix * t, cy + iy * a);
        g.lineTo(cx, cy + iy * a);
        g.closePath();
      }
    }
  };
  g.save();
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(15,22,48,0.45)';
  g.shadowBlur = s * 0.06;
  g.shadowOffsetY = s * 0.03;
  g.fillStyle = ARENA.navy;
  g.strokeStyle = ARENA.navy;
  g.lineWidth = s * 0.03;
  corners(s * 0.012);
  g.fill();
  g.stroke();
  g.restore();
  g.fillStyle = color;
  corners(0);
  g.fill();
}
