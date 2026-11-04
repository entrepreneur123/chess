/**
 * v6 "tactical hologram" board look (docs/design/v6-clean-tactical.md, palette of dark-arena.md)
 * shared by the WebGL board (as canvas textures + the cell shader in textures.ts) and the Canvas2D
 * fallback (painted straight into its static layers / cached marker sprites):
 *  - bezel: a slim dark bezel with a hairline edge, a faint cyan inner rim, ruler ticks at the cell
 *    lines, glowing HUD corner brackets, thin gold accents mid-side and a soft outer shadow;
 *  - field well: the near-black bed seen between the cells (the grid lines glow over it);
 *  - cells: flat deep-navy panels with very low contrast, a faint top-lit gradient and a thin glass
 *    rim (TILE_* constants, mirrored by the WebGL cell shader);
 *  - field overlay (over the cells): soft team glow washes in the home zones, a faint centre
 *    projection glow, a hex micro-texture, thin glowing cyan grid lines (team-tinted inside the home
 *    zones) with small cross marks at the intersections, and a light edge shadow under the bezel;
 *  - turn glow: a team-coloured rim light on the bezel edge, corner brackets lit in the team colour
 *    and a soft inward spill (setTurnGlow);
 *  - markers: luminous glow dots (own reach ice-cyan, enemy reach red), a glowing selection frame
 *    and a glowing capture ring, unchanged from v5. They are painted once into textures / sprites
 *    and blended additively (dots, selection) or normally (capture ring, which sits over a coin).
 * Everything is painted in raw canvas pixels from a cell size `s` and the pixel position (ox, oy)
 * of the field's top-left corner (col 0, row BOARD_SIZE - 1).
 * Pure Canvas2D: no three.js, so the 2D fallback stays light.
 */
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import { hexToRgb, mixRgb, rgbToCss } from './common';
import type { RGB } from './common';
import { ARENA, HOLO, TEAM_COLORS } from './palette';

/**
 * Bezel geometry, in cells. Two looks share every painter: the regular bezel (tablets, desktop) and
 * a slim one for narrow boards (phones), where every pixel of width should go to the cells.
 */
export interface FrameStyle {
  readonly id: 'regular' | 'slim';
  /** Bezel width around the field. */
  readonly width: number;
  /** Outer corner radius. */
  readonly radius: number;
  /** Depth of the dark lip visible under the bottom edge (screen-down). */
  readonly lip: number;
  /** Soft outer shadow onto the page. */
  readonly shadow: { readonly dy: number; readonly blur: number; readonly alpha: number };
  /** HUD corner brackets: inset from the outer edge, arm length, line width. */
  readonly bracket: { readonly inset: number; readonly arm: number; readonly width: number };
  /** Ruler tick lengths: minor, major (zone edges and the centre line). */
  readonly ticks: readonly [number, number];
  /** Gold accent bars: length on the top / bottom edge, on the sides, and thickness. */
  readonly gold: { readonly h: number; readonly v: number; readonly t: number };
  /** Room the views keep around the bezel for its glow (fit margin). */
  readonly glowRoom: number;
}

export const FRAME_REGULAR: FrameStyle = {
  id: 'regular',
  width: 0.28,
  radius: 0.16,
  lip: 0.05,
  shadow: { dy: 0.1, blur: 0.3, alpha: 0.75 },
  bracket: { inset: 0.075, arm: 0.95, width: 0.045 },
  ticks: [0.07, 0.13],
  gold: { h: 2.4, v: 1.6, t: 0.03 },
  glowRoom: 0.1,
};

/** Phones: a hairline-slim bezel (~5 px at 390 px wide) so the field spans almost the full width. */
export const FRAME_SLIM: FrameStyle = {
  id: 'slim',
  width: 0.12,
  radius: 0.09,
  lip: 0.025,
  shadow: { dy: 0.04, blur: 0.1, alpha: 0.6 },
  bracket: { inset: 0.025, arm: 0.6, width: 0.04 },
  ticks: [0.035, 0.065],
  gold: { h: 1.8, v: 1.2, t: 0.024 },
  glowRoom: 0.02,
};

/** Boards narrower than this (CSS px) use the slim bezel. */
export const SLIM_FRAME_BELOW_PX = 600;

export function frameStyleFor(cssWidth: number): FrameStyle {
  return cssWidth < SLIM_FRAME_BELOW_PX ? FRAME_SLIM : FRAME_REGULAR;
}

/** Field well reveal around the cells (cells). */
const WELL = 0.035;

/**
 * Extents of everything the frame paints, in cells outside the field (the WebGL board sizes its
 * frame plane from these).
 */
export function frameExtent(st: FrameStyle): { side: number; top: number; bottom: number } {
  return {
    side: st.width + st.shadow.blur,
    top: st.width + st.shadow.blur * 0.8,
    bottom: st.width + st.lip + st.shadow.dy + st.shadow.blur,
  };
}

/** What the views fit into the viewport: the bezel and its lip plus a little room for its glow. */
export function frameFit(st: FrameStyle): { side: number; top: number; bottom: number } {
  return {
    side: st.width + st.glowRoom,
    top: st.width + st.glowRoom,
    bottom: st.width + st.lip + st.glowRoom * 1.2,
  };
}

/** Margin (cells) the field overlay paints beyond the field (outer grid line glow). */
export const FIELD_OVERLAY_MARGIN = 0.1;

/**
 * Cell shape (fractions of a cell): a flat panel filling [TILE_INSET, 1-TILE_INSET] with rounded
 * corners; the gap between panels is where the grid lines glow.
 */
export const TILE_INSET = 0.032;
export const TILE_RADIUS = 0.05;
/** Width of the thin glass rim inside the panel edge, and its brightness (white mix, top edge). */
export const TILE_RIM = 0.03;
export const TILE_HIGHLIGHT = 0.07;
/** Top-lit face: brighter at the top, darker at the bottom (+- this fraction). */
export const TILE_FACE_GRAD = 0.04;

const IRON_TOP = hexToRgb(ARENA.ironTop);
const IRON_LIP = hexToRgb(ARENA.ironLip);
const BEZEL = hexToRgb(ARENA.bezel);
const LINE = hexToRgb(ARENA.line);
const NIGHT0 = hexToRgb(ARENA.night0);
const GRID = hexToRgb(ARENA.grid);
const GRID_CORE = hexToRgb(ARENA.gridCore);
const GOLD = hexToRgb(ARENA.gold);
const GOLD_DEEP = hexToRgb(ARENA.goldDeep);
const WHITE: RGB = [1, 1, 1];
const TEAM_GLOW: [RGB, RGB] = [hexToRgb(TEAM_COLORS[0].glow), hexToRgb(TEAM_COLORS[1].glow)];

export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  roundRectSub(g, x, y, w, h, r);
}

/** Rounded rect sub-path (no beginPath). */
function roundRectSub(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/**
 * Fill a frame-shaped region: the outer rect minus the inner rect (the inner one is a hole).
 * Used to cast a soft inner shadow / glow from the edges of the field.
 *
 * Never build such a hole with `rect(x, y, -w, h)`. The spec says a negative width reverses the
 * sub-path's winding, so a nonzero fill leaves a hole, and Chromium does that. WebKit builds rect()
 * with CoreGraphics' CGPathAddRect, which normalises the rect, so the winding never flips and the
 * "hole" fills solid on Safari: the field overlay turned opaque black and the additive turn glow
 * solid team blue (iPad report, v6). Here both sub-paths are explicit, wound in opposite
 * directions, and filled with the even-odd rule, which ignores winding altogether.
 */
export function fillFrameHole(
  g: CanvasRenderingContext2D,
  outer: readonly [number, number, number, number],
  inner: readonly [number, number, number, number],
): void {
  const [ox, oy, ow, oh] = outer;
  const [ix, iy, iw, ih] = inner;
  g.beginPath();
  g.moveTo(ox, oy);
  g.lineTo(ox + ow, oy);
  g.lineTo(ox + ow, oy + oh);
  g.lineTo(ox, oy + oh);
  g.closePath();
  g.moveTo(ix, iy);
  g.lineTo(ix, iy + ih);
  g.lineTo(ix + iw, iy + ih);
  g.lineTo(ix + iw, iy);
  g.closePath();
  g.fill('evenodd');
}

/** The four HUD corner brackets as one path (bezel corners). Arm length / inset in px. */
function bracketPath(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, inset: number, arm: number): void {
  const xa = x0 + inset;
  const ya = y0 + inset;
  const xb = x0 + w - inset;
  const yb = y0 + h - inset;
  g.beginPath();
  g.moveTo(xa, ya + arm);
  g.lineTo(xa, ya);
  g.lineTo(xa + arm, ya);
  g.moveTo(xb - arm, ya);
  g.lineTo(xb, ya);
  g.lineTo(xb, ya + arm);
  g.moveTo(xb, yb - arm);
  g.lineTo(xb, yb);
  g.lineTo(xb - arm, yb);
  g.moveTo(xa + arm, yb);
  g.lineTo(xa, yb);
  g.lineTo(xa, yb - arm);
}

/** Bezel (shadow, lip, face, hairlines, ruler ticks, corner brackets, gold accents, field well). */
export function paintFrame(g: CanvasRenderingContext2D, s: number, ox: number, oy: number, st: FrameStyle = FRAME_REGULAR): void {
  const n = BOARD_SIZE;
  const F = st.width;
  const BRACKET = st.bracket;
  const x0 = ox - F * s;
  const y0 = oy - F * s;
  const w = (n + F * 2) * s;
  const h = (n + F * 2) * s;
  const R = st.radius * s;
  const lip = st.lip * s;
  const px = Math.max(1, s * 0.022);

  // 1. Soft outer shadow (cast by the whole block, lip included) so the board floats.
  g.save();
  g.shadowColor = rgbToCss(NIGHT0, st.shadow.alpha);
  g.shadowBlur = st.shadow.blur * s;
  g.shadowOffsetY = st.shadow.dy * s;
  g.fillStyle = rgbToCss(IRON_LIP);
  roundRectPath(g, x0, y0 + lip, w, h, R);
  g.fill();
  g.restore();

  // 2. Lip: a thin dark front face.
  g.fillStyle = rgbToCss(mixRgb(BEZEL, IRON_LIP, 0.6));
  roundRectPath(g, x0, y0 + lip, w, h, R);
  g.fill();

  // 3. Bezel face: dark navy, faintly lit from the top.
  const fg = g.createLinearGradient(0, y0, 0, y0 + h);
  fg.addColorStop(0, rgbToCss(mixRgb(BEZEL, IRON_TOP, 0.55)));
  fg.addColorStop(0.08, rgbToCss(mixRgb(BEZEL, IRON_TOP, 0.18)));
  fg.addColorStop(1, rgbToCss(mixRgb(BEZEL, IRON_LIP, 0.3)));
  g.fillStyle = fg;
  roundRectPath(g, x0, y0, w, h, R);
  g.fill();

  // 4. Hairlines: the outer edge (doc line) with a light catch on top, and a fine inner line.
  g.lineWidth = px;
  g.strokeStyle = rgbToCss(LINE, 0.9);
  roundRectPath(g, x0 + px / 2, y0 + px / 2, w - px, h - px, R);
  g.stroke();
  const hl = g.createLinearGradient(0, y0, 0, y0 + h * 0.5);
  hl.addColorStop(0, rgbToCss(WHITE, 0.16));
  hl.addColorStop(1, rgbToCss(WHITE, 0));
  g.strokeStyle = hl;
  roundRectPath(g, x0 + px * 1.5, y0 + px * 1.5, w - px * 3, h - px * 3, Math.max(0, R - px));
  g.stroke();

  // 5. Ruler ticks along the inner edge at every cell line (longer every 3 cells).
  const ti = Math.max(F * 0.5, F - 0.02) * s; // tick base: just outside the field well
  g.strokeStyle = rgbToCss(GRID, 0.3);
  g.lineWidth = Math.max(1, s * 0.016);
  g.beginPath();
  for (let k = 1; k < n; k++) {
    // Major ticks on the zone edge lines and the centre line.
    const major = k === ZONE_DEPTH || k === n - ZONE_DEPTH || k * 2 === n;
    const len = (major ? st.ticks[1] : st.ticks[0]) * s;
    const p = k * s;
    g.moveTo(ox + p, y0 + ti);
    g.lineTo(ox + p, y0 + ti - len);
    g.moveTo(ox + p, y0 + h - ti);
    g.lineTo(ox + p, y0 + h - ti + len);
    g.moveTo(x0 + ti, oy + p);
    g.lineTo(x0 + ti - len, oy + p);
    g.moveTo(x0 + w - ti, oy + p);
    g.lineTo(x0 + w - ti + len, oy + p);
  }
  g.stroke();

  // 6. HUD corner brackets: a soft cyan glow under a bright core line.
  const bi = BRACKET.inset * s;
  const arm = BRACKET.arm * s;
  const bw = Math.max(1.2, BRACKET.width * s);
  g.save();
  g.lineCap = 'square';
  g.lineJoin = 'miter';
  g.strokeStyle = rgbToCss(GRID, 0.28);
  g.lineWidth = bw * 3;
  bracketPath(g, x0, y0, w, h, bi, arm);
  g.stroke();
  g.shadowColor = rgbToCss(GRID, 0.9);
  g.shadowBlur = s * 0.12;
  g.strokeStyle = rgbToCss(GRID_CORE, 0.95);
  g.lineWidth = bw;
  bracketPath(g, x0, y0, w, h, bi, arm);
  g.stroke();
  g.restore();

  // 7. Thin gold accents: a short gilded bar centred on each side of the bezel.
  const gold = (cx: number, cy: number, horizontal: boolean, len: number): void => {
    const t = Math.max(1, s * st.gold.t);
    const gg = horizontal ? g.createLinearGradient(cx - len / 2, 0, cx + len / 2, 0) : g.createLinearGradient(0, cy - len / 2, 0, cy + len / 2);
    gg.addColorStop(0, rgbToCss(GOLD_DEEP, 0));
    gg.addColorStop(0.2, rgbToCss(GOLD_DEEP, 0.9));
    gg.addColorStop(0.5, rgbToCss(mixRgb(GOLD, WHITE, 0.3)));
    gg.addColorStop(0.8, rgbToCss(GOLD_DEEP, 0.9));
    gg.addColorStop(1, rgbToCss(GOLD_DEEP, 0));
    g.fillStyle = gg;
    if (horizontal) g.fillRect(cx - len / 2, cy - t / 2, len, t);
    else g.fillRect(cx - t / 2, cy - len / 2, t, len);
  };
  const mid = (F * s) / 2;
  gold(ox + (n * s) / 2, y0 + mid, true, st.gold.h * s);
  gold(ox + (n * s) / 2, y0 + h - mid, true, st.gold.h * s);
  gold(x0 + mid, oy + (n * s) / 2, false, st.gold.v * s);
  gold(x0 + w - mid, oy + (n * s) / 2, false, st.gold.v * s);

  // 8. Field well: the near-black bed between the cells, with a faint cyan inner rim.
  const wx = ox - WELL * s;
  const wy = oy - WELL * s;
  const ww = (n + WELL * 2) * s;
  const wr = s * 0.06;
  g.fillStyle = ARENA.bed;
  roundRectPath(g, wx, wy, ww, ww, wr);
  g.fill();
  g.lineWidth = px;
  g.strokeStyle = rgbToCss(GRID, 0.4);
  roundRectPath(g, wx - px / 2, wy - px / 2, ww + px, ww + px, wr + px / 2);
  g.stroke();
}

/** Darken / lighten an sRGB colour (0..1) toward black / white. */
function shade(c: RGB, k: number): RGB {
  return k <= 1 ? [c[0] * k, c[1] * k, c[2] * k] : mixRgb(c, WHITE, k - 1);
}

/** Canvas path of a cell panel at cell origin (x, y), cell size s. */
export function tileOuterPath(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const i = TILE_INSET * s;
  roundRectPath(g, x + i, y + i, s - i * 2, s - i * 2, TILE_RADIUS * s);
}

/** Paint one flat hologram cell of colour `c` (sRGB 0..1) at cell origin (x, y), cell size s. */
export function paintTile(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: RGB): void {
  const i = TILE_INSET * s;
  const ty = y + i;
  const th = s - i * 2;
  const fg = g.createLinearGradient(0, ty, 0, ty + th);
  fg.addColorStop(0, rgbToCss(shade(c, 1 + TILE_FACE_GRAD)));
  fg.addColorStop(1, rgbToCss(shade(c, 1 - TILE_FACE_GRAD)));
  g.fillStyle = fg;
  tileOuterPath(g, x, y, s);
  g.fill();
  // Thin glass rim inside the edge, brightest along the top (as the cell shader).
  g.save();
  tileOuterPath(g, x, y, s);
  g.clip();
  const rg = g.createLinearGradient(0, ty, 0, ty + th);
  rg.addColorStop(0, rgbToCss(WHITE, TILE_HIGHLIGHT));
  rg.addColorStop(1, rgbToCss(WHITE, TILE_HIGHLIGHT * 0.35));
  g.strokeStyle = rg;
  g.lineWidth = TILE_RIM * s * 2;
  tileOuterPath(g, x, y, s);
  g.stroke();
  g.restore();
}

/**
 * Over the cells: team glow washes in the home zones, the centre projection glow, the hex
 * micro-texture, the glowing grid (team-tinted in the home zones) with intersection crosses, and a
 * light edge shadow under the bezel. Covers the field plus FIELD_OVERLAY_MARGIN; static.
 */
export function paintFieldOverlay(
  g: CanvasRenderingContext2D,
  s: number,
  ox: number,
  oy: number,
  opts: { edgeShadow?: boolean } = {},
): void {
  const n = BOARD_SIZE;
  const size = n * s;
  const m = FIELD_OVERLAY_MARGIN * s;
  g.save();
  g.beginPath();
  g.rect(ox - m, oy - m, size + m * 2, size + m * 2);
  g.clip();

  // 1. Home-zone team washes: strongest at the zone edge line, fading toward the back rank.
  const zh = ZONE_DEPTH * s;
  const wash = (team: 0 | 1): void => {
    const top = team === 1 ? oy : oy + size - zh;
    const edgeY = team === 1 ? top + zh : top;
    const backY = team === 1 ? top : top + zh;
    const lg = g.createLinearGradient(0, edgeY, 0, backY);
    lg.addColorStop(0, rgbToCss(TEAM_GLOW[team], HOLO.zoneWashEdge));
    lg.addColorStop(0.4, rgbToCss(TEAM_GLOW[team], HOLO.zoneWashEdge * 0.35));
    lg.addColorStop(1, rgbToCss(TEAM_GLOW[team], HOLO.zoneWashBack));
    g.fillStyle = lg;
    g.fillRect(ox, top, size, zh);
  };
  wash(0);
  wash(1);

  // 2. Centre projection glow (the field reads as a lit hologram, brightest in the middle).
  const cx = ox + size / 2;
  const cy = oy + size / 2;
  const cg = g.createRadialGradient(cx, cy, 0, cx, cy, size * 0.85);
  cg.addColorStop(0, rgbToCss(GRID, HOLO.centreGlow));
  cg.addColorStop(1, rgbToCss(GRID, 0));
  g.fillStyle = cg;
  g.fillRect(ox, oy, size, size);

  // 3. Hex micro-texture (flat-top hexes, ~2.5 per cell), very faint.
  const hr = s * 0.2;
  const hx = hr * 1.5;
  const hy = hr * Math.sqrt(3);
  g.beginPath();
  for (let col = 0, x = ox - hr; x < ox + size + hr; col++, x += hx) {
    for (let y = oy - hy + (col % 2 ? hy / 2 : 0); y < oy + size + hy; y += hy) {
      // Three edges per hex (top, upper-right, lower-right): the tiling draws every edge once.
      g.moveTo(x - hr / 2, y - hy / 2);
      g.lineTo(x + hr / 2, y - hy / 2);
      g.lineTo(x + hr, y);
      g.lineTo(x + hr / 2, y + hy / 2);
    }
  }
  g.strokeStyle = rgbToCss(GRID, HOLO.hex);
  g.lineWidth = Math.max(0.75, s * 0.012);
  g.stroke();

  // 4. Grid lines on every cell line: a soft glow, then a thin core. Vertical lines change to the
  //    team tint inside the home zones; horizontal lines inside a zone take its team tint.
  const zoneFrac = ZONE_DEPTH / n;
  const vStroke = (alpha: number): CanvasGradient => {
    const vg = g.createLinearGradient(0, oy, 0, oy + size);
    const red = mixRgb(GRID, TEAM_GLOW[1], 0.75);
    const blue = mixRgb(GRID, TEAM_GLOW[0], 0.45);
    vg.addColorStop(0, rgbToCss(red, alpha));
    vg.addColorStop(zoneFrac - 0.01, rgbToCss(red, alpha));
    vg.addColorStop(zoneFrac + 0.03, rgbToCss(GRID, alpha));
    vg.addColorStop(1 - zoneFrac - 0.03, rgbToCss(GRID, alpha));
    vg.addColorStop(1 - zoneFrac + 0.01, rgbToCss(blue, alpha));
    vg.addColorStop(1, rgbToCss(blue, alpha));
    return vg;
  };
  const hColor = (k: number): RGB => {
    // k = line index from the top (0..BOARD_SIZE); the zone edges (ZONE_DEPTH, BOARD_SIZE - ZONE_DEPTH) are drawn by the zone edge lines.
    if (k < ZONE_DEPTH) return mixRgb(GRID, TEAM_GLOW[1], 0.75);
    if (k > n - ZONE_DEPTH) return mixRgb(GRID, TEAM_GLOW[0], 0.45);
    return GRID;
  };
  const lines = (width: number, alpha: number, major: number): void => {
    g.lineWidth = width;
    g.strokeStyle = vStroke(alpha);
    g.beginPath();
    for (let k = 0; k <= n; k++) {
      g.moveTo(ox + k * s, oy);
      g.lineTo(ox + k * s, oy + size);
    }
    g.stroke();
    for (let k = 0; k <= n; k++) {
      const a = k === n / 2 ? major : alpha;
      g.strokeStyle = rgbToCss(hColor(k), a);
      g.beginPath();
      g.moveTo(ox, oy + k * s);
      g.lineTo(ox + size, oy + k * s);
      g.stroke();
    }
  };
  lines(s * 0.1, HOLO.gridGlow, HOLO.gridGlow * 1.6);
  lines(Math.max(1, s * 0.02), HOLO.gridCore, HOLO.gridMajor);

  // 5. Small bright crosses on the intersections (HUD map marks).
  const cl = s * 0.075;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = ox + i * s;
      const y = oy + j * s;
      g.moveTo(x - cl, y);
      g.lineTo(x + cl, y);
      g.moveTo(x, y - cl);
      g.lineTo(x, y + cl);
    }
  }
  g.strokeStyle = rgbToCss(GRID_CORE, 0.38);
  g.lineWidth = Math.max(1, s * 0.022);
  g.stroke();

  // 6. Soft edge shadow where the field meets the bezel (skipped by the self-test retry).
  if (opts.edgeShadow === false) {
    g.restore();
    return;
  }
  g.beginPath();
  g.rect(ox, oy, size, size);
  g.clip();
  g.shadowColor = rgbToCss(NIGHT0, 0.7);
  g.shadowBlur = 0.35 * s;
  g.shadowOffsetY = 0.06 * s;
  g.fillStyle = '#000';
  fillFrameHole(g, [ox - s * 4, oy - s * 4, size + s * 8, size + s * 8], [ox, oy, size, size]);
  g.restore();
}

/**
 * Turn glow (setTurnGlow): a rim light along the bezel's inner edge, a softer one on its outer edge,
 * the corner brackets lit and a soft inward spill over the outer cells, all in `color`. Painted in
 * the frame's coordinates (field top-left at (ox, oy)); blend additively. The WebGL board paints it
 * white and tints it with the material colour.
 */
export function paintTurnGlow(
  g: CanvasRenderingContext2D,
  s: number,
  ox: number,
  oy: number,
  color: RGB,
  st: FrameStyle = FRAME_REGULAR,
  opts: { spill?: boolean } = {},
): void {
  const n = BOARD_SIZE;
  const F = st.width;
  const size = n * s;
  const x0 = ox - F * s;
  const y0 = oy - F * s;
  const w = (n + F * 2) * s;
  const R = st.radius * s;
  g.save();
  // Inward spill over the outer cells (shadow of a frame-shaped hole, clipped to the field).
  // Skipped by the self-test retry if an engine fills the hole.
  if (opts.spill !== false) {
    g.save();
    g.beginPath();
    g.rect(ox - WELL * s, oy - WELL * s, size + WELL * 2 * s, size + WELL * 2 * s);
    g.clip();
    g.shadowColor = rgbToCss(color, 0.5);
    g.shadowBlur = 0.9 * s;
    g.fillStyle = rgbToCss(color, 1);
    fillFrameHole(g, [ox - s * 3, oy - s * 3, size + s * 6, size + s * 6], [ox, oy, size, size]);
    g.restore();
  }
  // Rim light on the bezel's inner edge (wide soft + bright core).
  const wx = ox - WELL * s;
  const wy = oy - WELL * s;
  const ww = size + WELL * 2 * s;
  g.lineJoin = 'round';
  g.strokeStyle = rgbToCss(color, 0.35);
  g.lineWidth = s * 0.16;
  roundRectPath(g, wx, wy, ww, ww, s * 0.08);
  g.stroke();
  g.shadowColor = rgbToCss(color, 1);
  g.shadowBlur = s * 0.2;
  g.strokeStyle = rgbToCss(mixRgb(color, WHITE, 0.35), 0.95);
  g.lineWidth = Math.max(1.5, s * 0.04);
  roundRectPath(g, wx, wy, ww, ww, s * 0.08);
  g.stroke();
  // Outer edge glow (stays within the views' fit margin).
  g.shadowBlur = s * 0.12;
  g.strokeStyle = rgbToCss(color, 0.55);
  g.lineWidth = Math.max(1, s * 0.03);
  roundRectPath(g, x0, y0, w, w, R);
  g.stroke();
  // Corner brackets lit in the team colour.
  g.lineCap = 'square';
  g.shadowBlur = s * 0.16;
  g.strokeStyle = rgbToCss(mixRgb(color, WHITE, 0.25), 1);
  g.lineWidth = Math.max(1.5, st.bracket.width * s * 1.3);
  bracketPath(g, x0, y0, w, w, st.bracket.inset * s, st.bracket.arm * s);
  g.stroke();
  g.restore();
}

/**
 * Self-test for the painted field layers: alpha (0..1) of one pixel at (x, y), or -1 if it cannot
 * be read. The field centre of the overlay and of the turn glow must stay see-through; if a canvas
 * engine fills a frame-shaped hole solid (WebKit's rect() normalisation was one such case), the
 * caller repaints without the hole-based effect instead of hiding the cells.
 */
export function alphaAt(g: CanvasRenderingContext2D, x: number, y: number): number {
  try {
    return g.getImageData(Math.round(x), Math.round(y), 1, 1).data[3] / 255;
  } catch {
    return -1;
  }
}

/** Highest alpha the field centre of a see-through layer may have (overlay washes are ~0.1). */
export const SEE_THROUGH_MAX_ALPHA = 0.5;

// ---------------------------------------------------------------- markers (sprites / textures)

/**
 * Luminous move-target dot: a white-hot core fading into a soft halo of `color` (sRGB 0..1).
 * Blend additively. (x, y) = centre, R = halo radius (px). Mirrors the pre-v4 dot texture.
 */
export function paintGlowDot(g: CanvasRenderingContext2D, x: number, y: number, R: number, color: RGB, whiten = 0.55): void {
  const core = mixRgb(color, WHITE, whiten);
  const gr = g.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, rgbToCss(mixRgb(core, WHITE, whiten * 0.7), 1));
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
  const half = s * 0.48;
  const r = s * 0.16;
  const path = (): void => roundRectPath(g, x - half, y - half, half * 2, half * 2, r);
  g.save();
  g.lineJoin = 'round';
  // Wide soft glow spilling over the gap onto the neighbours, then the bright line + hot core.
  g.strokeStyle = rgbToCss(color, 0.2);
  g.lineWidth = s * 0.2;
  path();
  g.stroke();
  g.strokeStyle = rgbToCss(color, 0.35);
  g.lineWidth = s * 0.11;
  path();
  g.stroke();
  g.shadowColor = rgbToCss(color, 1);
  g.shadowBlur = s * 0.1;
  g.strokeStyle = rgbToCss(color, 1);
  g.lineWidth = s * 0.06;
  path();
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = rgbToCss(mixRgb(color, WHITE, 0.65), 1);
  g.lineWidth = s * 0.024;
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
export const MARKER_QUAD = { dot: 0.95, select: 1.36, capture: 1.3 } as const;

/** How much the glow-dot core whitens: own reach glows ice-white, enemy reach keeps its red. */
export const DOT_WHITEN = { own: 0.55, enemy: 0.3 } as const;
