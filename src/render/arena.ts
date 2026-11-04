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
import { hexToRgb, makeRng, mixRgb, rgbToCss } from './common';
import type { RGB } from './common';
import { ARENA, TEAM_COLORS } from './palette';
import { DEFAULT_BOARD_THEME } from './arenaThemes';
import type { BoardTheme } from './arenaThemes';

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

const NIGHT0 = hexToRgb(ARENA.night0);
const WHITE: RGB = [1, 1, 1];
const TEAM_GLOW: [RGB, RGB] = [hexToRgb(TEAM_COLORS[0].glow), hexToRgb(TEAM_COLORS[1].glow)];

/** A board theme's colours as sRGB 0..1 triples (computed once per theme). */
interface ThemeRgb {
  face: RGB;
  top: RGB;
  lip: RGB;
  line: RGB;
  grid: RGB;
  gridCore: RGB;
  accent: RGB;
  accentDeep: RGB;
  bracket: RGB;
  bracketCore: RGB;
  d0: RGB;
  d1: RGB;
}
const themeRgbs = new Map<BoardTheme, ThemeRgb>();
function rgbOf(t: BoardTheme): ThemeRgb {
  let v = themeRgbs.get(t);
  if (!v) {
    v = {
      face: hexToRgb(t.bezel.face),
      top: hexToRgb(t.bezel.top),
      lip: hexToRgb(t.bezel.lip),
      line: hexToRgb(t.bezel.line),
      grid: hexToRgb(t.grid),
      gridCore: hexToRgb(t.gridCore),
      accent: hexToRgb(t.accent),
      accentDeep: hexToRgb(t.accentDeep),
      bracket: hexToRgb(t.bracket),
      bracketCore: hexToRgb(t.bracketCore),
      d0: hexToRgb(t.detailColors[0]),
      d1: hexToRgb(t.detailColors[1]),
    };
    themeRgbs.set(t, v);
  }
  return v;
}

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
export function paintFrame(
  g: CanvasRenderingContext2D,
  s: number,
  ox: number,
  oy: number,
  st: FrameStyle = FRAME_REGULAR,
  theme: BoardTheme = DEFAULT_BOARD_THEME,
): void {
  const T = rgbOf(theme);
  const BEZEL = T.face;
  const IRON_TOP = T.top;
  const IRON_LIP = T.lip;
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
  g.strokeStyle = rgbToCss(T.line, 0.9);
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
  g.strokeStyle = rgbToCss(T.grid, 0.3);
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
  g.strokeStyle = rgbToCss(T.bracket, 0.28);
  g.lineWidth = bw * 3;
  bracketPath(g, x0, y0, w, h, bi, arm);
  g.stroke();
  g.shadowColor = rgbToCss(T.bracket, 0.9);
  g.shadowBlur = s * 0.12;
  g.strokeStyle = rgbToCss(T.bracketCore, 0.95);
  g.lineWidth = bw;
  bracketPath(g, x0, y0, w, h, bi, arm);
  g.stroke();
  g.restore();
  if (theme.jewel !== 'none') paintJewels(g, theme.jewel, T, x0 + bi, y0 + bi, x0 + w - bi, y0 + h - bi, bw);

  // 7. Thin gold accents: a short gilded bar centred on each side of the bezel.
  const gold = (cx: number, cy: number, horizontal: boolean, len: number): void => {
    const t = Math.max(1, s * st.gold.t);
    const gg = horizontal ? g.createLinearGradient(cx - len / 2, 0, cx + len / 2, 0) : g.createLinearGradient(0, cy - len / 2, 0, cy + len / 2);
    gg.addColorStop(0, rgbToCss(T.accentDeep, 0));
    gg.addColorStop(0.2, rgbToCss(T.accentDeep, 0.9));
    gg.addColorStop(0.5, rgbToCss(mixRgb(T.accent, WHITE, 0.3)));
    gg.addColorStop(0.8, rgbToCss(T.accentDeep, 0.9));
    gg.addColorStop(1, rgbToCss(T.accentDeep, 0));
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
  g.fillStyle = theme.bed;
  roundRectPath(g, wx, wy, ww, ww, wr);
  g.fill();
  g.lineWidth = px;
  g.strokeStyle = rgbToCss(T.grid, 0.4);
  roundRectPath(g, wx - px / 2, wy - px / 2, ww + px, ww + px, wr + px / 2);
  g.stroke();
}

/**
 * A small ornament at each bezel corner (the bracket's corner points (xa, ya) / (xb, yb)): an iron
 * rivet, a gem diamond, a four-point star or an ice crystal, in the theme's accent / bracket tones.
 */
function paintJewels(g: CanvasRenderingContext2D, kind: BoardTheme['jewel'], T: ThemeRgb, xa: number, ya: number, xb: number, yb: number, bw: number): void {
  const r = Math.max(1.5, bw * 1.7);
  g.save();
  for (const [x, y] of [
    [xa, ya],
    [xb, ya],
    [xb, yb],
    [xa, yb],
  ] as const) {
    g.beginPath();
    if (kind === 'rivet') {
      g.arc(x, y, r, 0, Math.PI * 2);
      const rg = g.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r);
      rg.addColorStop(0, rgbToCss(mixRgb(T.accent, WHITE, 0.55)));
      rg.addColorStop(0.55, rgbToCss(T.accent));
      rg.addColorStop(1, rgbToCss(T.accentDeep));
      g.fillStyle = rg;
      g.fill();
      continue;
    }
    if (kind === 'diamond') {
      const k = r * 1.35;
      g.moveTo(x, y - k);
      g.lineTo(x + k, y);
      g.lineTo(x, y + k);
      g.lineTo(x - k, y);
    } else if (kind === 'crystal') {
      // A long six-sided ice shard along the corner diagonal.
      const dx = x < (xa + xb) / 2 ? 1 : -1;
      const dy = y < (ya + yb) / 2 ? 1 : -1;
      const L = r * 2;
      const W = r * 0.75;
      g.moveTo(x - dx * L * 0.35, y - dy * L * 0.35);
      g.lineTo(x + dx * W * 0.7, y - dy * W * 0.7 + dy * L * 0.05);
      g.lineTo(x + dx * L, y + dy * L);
      g.lineTo(x - dx * W * 0.7 + dx * L * 0.05, y + dy * W * 0.7);
    } else {
      // Four-point star.
      const k = r * 2;
      const q = r * 0.42;
      g.moveTo(x, y - k);
      g.lineTo(x + q, y - q);
      g.lineTo(x + k, y);
      g.lineTo(x + q, y + q);
      g.lineTo(x, y + k);
      g.lineTo(x - q, y + q);
      g.lineTo(x - k, y);
      g.lineTo(x - q, y - q);
    }
    g.closePath();
    g.shadowColor = rgbToCss(kind === 'diamond' ? T.accent : T.bracket, 0.9);
    g.shadowBlur = r * 2.2;
    g.fillStyle = rgbToCss(kind === 'diamond' ? T.accent : mixRgb(T.bracketCore, T.bracket, 0.25));
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = Math.max(0.75, r * 0.28);
    g.strokeStyle = rgbToCss(mixRgb(kind === 'diamond' ? T.accent : T.bracketCore, WHITE, 0.6), 0.9);
    g.stroke();
  }
  g.restore();
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
  opts: { edgeShadow?: boolean; theme?: BoardTheme } = {},
): void {
  const theme = opts.theme ?? DEFAULT_BOARD_THEME;
  const HOLO = theme.holo;
  const T = rgbOf(theme);
  const GRID = T.grid;
  const GRID_CORE = T.gridCore;
  const [mixBlue, mixRed] = theme.zoneGridMix;
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

  // 3. Hex micro-texture (flat-top hexes, ~2.5 per cell), very faint (the hologram look only;
  //    other arenas paint their own surface detail instead).
  if (HOLO.hex > 0) paintHex(g, s, ox, oy, size, GRID, HOLO.hex);
  paintSurfaceDetail(g, s, ox, oy, theme);

  // 4. Grid lines on every cell line: a soft glow, then a thin core. Vertical lines change to the
  //    team tint inside the home zones; horizontal lines inside a zone take its team tint.
  const zoneFrac = ZONE_DEPTH / n;
  const red = mixRgb(GRID, TEAM_GLOW[1], mixRed);
  const blue = mixRgb(GRID, TEAM_GLOW[0], mixBlue);
  const vStroke = (alpha: number): CanvasGradient => {
    const vg = g.createLinearGradient(0, oy, 0, oy + size);
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
    if (k < ZONE_DEPTH) return red;
    if (k > n - ZONE_DEPTH) return blue;
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

/** Hex micro-texture (flat-top hexes, ~2.5 per cell) over the field. */
function paintHex(g: CanvasRenderingContext2D, s: number, ox: number, oy: number, size: number, color: RGB, alpha: number): void {
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
  g.strokeStyle = rgbToCss(color, alpha);
  g.lineWidth = Math.max(0.75, s * 0.012);
  g.stroke();
}

/**
 * The arena's surface detail (BoardTheme.detail), painted once into the static field overlay under
 * the grid lines: deterministic (seeded per arena), clipped to the field, faint (every marker and
 * tint stays readable over it). Glows are wide translucent strokes, not shadowBlur, so a 1.5k px
 * overlay still paints in a few ms.
 */
export function paintSurfaceDetail(g: CanvasRenderingContext2D, s: number, ox: number, oy: number, theme: BoardTheme): void {
  const size = BOARD_SIZE * s;
  const T = rgbOf(theme);
  const k = theme.detailStrength;
  if (k <= 0) return;
  const rnd = makeRng(DETAIL_SEED[theme.detail]);
  g.save();
  g.beginPath();
  g.rect(ox, oy, size, size);
  g.clip();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  DETAIL_PAINTERS[theme.detail](g, s, ox, oy, size, T, k, rnd);
  g.restore();
}

type DetailPainter = (g: CanvasRenderingContext2D, s: number, ox: number, oy: number, size: number, T: ThemeRgb, k: number, rnd: () => number) => void;

const DETAIL_SEED: Record<BoardTheme['detail'], number> = { runes: 0x6d00, cracks: 0xe3b1, moss: 0xb11e, frost: 0xf205, filigree: 0xc401, stars: 0xa9e7 };

/** Soft round blob (radial gradient) of colour c, peak alpha a, radius r; optional x-stretch. */
function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number, stretch = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(stretch, 1);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, r);
  rg.addColorStop(0, rgbToCss(c, a));
  rg.addColorStop(0.55, rgbToCss(c, a * 0.45));
  rg.addColorStop(1, rgbToCss(c, 0));
  g.fillStyle = rg;
  g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();
}

/** Stroke the current path three times: wide soft glow, medium glow, thin hot core. */
function glowStroke(g: CanvasRenderingContext2D, s: number, glow: RGB, core: RGB, a: number, w = 1): void {
  g.strokeStyle = rgbToCss(glow, 0.06 * a);
  g.lineWidth = s * 0.1 * w;
  g.stroke();
  g.strokeStyle = rgbToCss(glow, 0.14 * a);
  g.lineWidth = s * 0.042 * w;
  g.stroke();
  g.strokeStyle = rgbToCss(core, 0.42 * a);
  g.lineWidth = Math.max(0.75, s * 0.014 * w);
  g.stroke();
}

const DETAIL_PAINTERS: Record<BoardTheme['detail'], DetailPainter> = {
  /** moonrune: a moonlit rune circle etched around the centre, a hexagram and small glyphs. */
  runes(g, s, ox, oy, size, T, k, rnd) {
    const cx = ox + size / 2;
    const cy = oy + size / 2;
    const R1 = s * 2.4;
    const R2 = s * 2.02;
    g.lineWidth = Math.max(0.75, s * 0.018);
    g.strokeStyle = rgbToCss(T.d0, 0.11 * k);
    for (const r of [R1, R2, s * 1.25]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    // Glyph band: angular rune strokes between the two outer rings.
    g.strokeStyle = rgbToCss(T.d1, 0.12 * k);
    g.lineWidth = Math.max(0.75, s * 0.016);
    g.beginPath();
    const N = 28;
    const gh = (R1 - R2) * 0.32;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rm = (R1 + R2) / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Local frame: u = tangent, v = radial.
      const P = (u: number, v: number): [number, number] => [cx + ca * (rm + v) - sa * u, cy + sa * (rm + v) + ca * u];
      const strokes = 2 + Math.floor(rnd() * 2);
      for (let j = 0; j < strokes; j++) {
        const [x1, y1] = P((rnd() - 0.5) * gh * 1.4, (rnd() - 0.5) * gh * 2);
        const [x2, y2] = P((rnd() - 0.5) * gh * 1.4, (rnd() - 0.5) * gh * 2);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      }
    }
    g.stroke();
    // Hexagram inside the inner ring.
    g.strokeStyle = rgbToCss(T.d0, 0.07 * k);
    g.beginPath();
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i <= 3; i++) {
        const a = -Math.PI / 2 + t * Math.PI + (i * Math.PI * 2) / 3;
        const x = cx + Math.cos(a) * s * 1.25;
        const y = cy + Math.sin(a) * s * 1.25;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.stroke();
    // A soft moonlight pool at the centre.
    blob(g, cx, cy, s * 2.6, T.d1, 0.035 * k);
  },

  /** emberforge: molten cracks through the iron plates, with faint glowing pools where they start. */
  cracks(g, s, ox, oy, size, T, k, rnd) {
    const hot = mixRgb(T.d1, WHITE, 0.25);
    const crack = (x: number, y: number, a: number, segs: number, len: number, w: number, branch: boolean): void => {
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < segs; i++) {
        a += (rnd() - 0.5) * 1.1;
        const l = len * (0.6 + rnd() * 0.8);
        x += Math.cos(a) * l;
        y += Math.sin(a) * l;
        g.lineTo(x, y);
        if (branch && rnd() < 0.28) {
          const bx = x;
          const by = y;
          const ba = a + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.6);
          // Branches are drawn as their own sub-paths after this one.
          pending.push([bx, by, ba, 2 + Math.floor(rnd() * 3), len * 0.7, w * 0.7]);
        }
      }
      glowStroke(g, s, T.d0, hot, k, w);
    };
    const pending: [number, number, number, number, number, number][] = [];
    const N = 15;
    for (let i = 0; i < N; i++) {
      const x = ox + rnd() * size;
      const y = oy + rnd() * size;
      blob(g, x, y, s * (0.45 + rnd() * 0.5), T.d0, 0.05 * k);
      crack(x, y, rnd() * Math.PI * 2, 4 + Math.floor(rnd() * 5), s * 0.26, 0.8 + rnd() * 0.5, true);
    }
    for (const b of pending) crack(b[0], b[1], b[2], b[3], b[4], b[5], false);
    // Heat haze rising from the bottom and top edges (the forge below the plates).
    for (const [y, a] of [
      [oy + size, 0.05],
      [oy, 0.03],
    ] as const) {
      const lg = g.createLinearGradient(0, y, 0, y + (y === oy ? 1 : -1) * s * 1.6);
      lg.addColorStop(0, rgbToCss(T.d0, a * k));
      lg.addColorStop(1, rgbToCss(T.d0, 0));
      g.fillStyle = lg;
      g.fillRect(ox, Math.min(y, y + (y === oy ? 1 : -1) * s * 1.6), size, s * 1.6);
    }
  },

  /** blightmire: moss and fog mottling, a few creeping roots and lichen specks. */
  moss(g, s, ox, oy, size, T, k, rnd) {
    for (let i = 0; i < 30; i++) {
      const x = ox + rnd() * size;
      const y = oy + rnd() * size;
      const r = s * (0.5 + rnd() * 1.1);
      if (rnd() < 0.62) blob(g, x, y, r, T.d1, 0.26 * k, 1 + rnd() * 0.6);
      else blob(g, x, y, r, T.d0, 0.055 * k, 1.4 + rnd() * 0.8);
    }
    // Fog drifting across the middle rows.
    for (let i = 0; i < 4; i++) blob(g, ox + size * (0.15 + rnd() * 0.7), oy + size * (0.4 + rnd() * 0.2), s * (1.2 + rnd() * 0.6), T.d0, 0.05 * k, 2.4);
    // Roots creeping in from the edges.
    const root = mixRgb(T.d1, [0, 0, 0], 0.4);
    for (let i = 0; i < 8; i++) {
      const side = i % 4;
      const t = 0.1 + rnd() * 0.8;
      let x = side === 0 ? ox : side === 1 ? ox + size : ox + t * size;
      let y = side === 2 ? oy : side === 3 ? oy + size : oy + t * size;
      let a = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      g.beginPath();
      g.moveTo(x, y);
      const segs = 5 + Math.floor(rnd() * 4);
      for (let j = 0; j < segs; j++) {
        a += (rnd() - 0.5) * 0.9;
        const l = s * (0.3 + rnd() * 0.25);
        const mx = x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * s * 0.15;
        const my = y + Math.sin(a) * l * 0.5 + (rnd() - 0.5) * s * 0.15;
        x += Math.cos(a) * l;
        y += Math.sin(a) * l;
        g.quadraticCurveTo(mx, my, x, y);
      }
      g.strokeStyle = rgbToCss(root, 0.42 * k);
      g.lineWidth = s * 0.05;
      g.stroke();
      g.strokeStyle = rgbToCss(T.d0, 0.07 * k);
      g.lineWidth = Math.max(0.75, s * 0.014);
      g.stroke();
    }
    // Lichen specks.
    g.fillStyle = rgbToCss(T.d0, 0.1 * k);
    for (let i = 0; i < 140; i++) {
      const r = s * (0.008 + rnd() * 0.014);
      g.fillRect(ox + rnd() * size - r, oy + rnd() * size - r, r * 2, r * 2);
    }
  },

  /** frostkeep: a faint aurora veil over the field and frost crystals growing in from the edges. */
  frost(g, s, ox, oy, size, T, k, rnd) {
    // Aurora: two wavy soft curtains (aqua-green, then violet) across the upper middle.
    const veil = (y0: number, amp: number, c: RGB, a: number, phase: number): void => {
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const x = ox - s + (i / 24) * (size + s * 2);
        const y = y0 + Math.sin(i * 0.55 + phase) * amp + Math.sin(i * 0.21 + phase * 2) * amp * 0.6;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = rgbToCss(c, a * 0.5 * k);
      g.lineWidth = s * 1.5;
      g.stroke();
      g.strokeStyle = rgbToCss(c, a * k);
      g.lineWidth = s * 0.55;
      g.stroke();
    };
    veil(oy + size * 0.42, s * 0.45, T.d1, 0.04, 0.3);
    veil(oy + size * 0.56, s * 0.35, [0.62, 0.5, 1], 0.03, 2.1);
    // Frost dendrites: a stem with paired side branches, recursively (depth 2).
    const branchPath = (x: number, y: number, a: number, len: number, depth: number): void => {
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      g.moveTo(x, y);
      g.lineTo(ex, ey);
      if (depth <= 0) return;
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const bx = x + (ex - x) * t;
        const by = y + (ey - y) * t;
        const bl = len * (0.42 - t * 0.22);
        branchPath(bx, by, a + Math.PI / 3, bl, depth - 1);
        branchPath(bx, by, a - Math.PI / 3, bl, depth - 1);
      }
    };
    g.beginPath();
    const corners: [number, number, number][] = [
      [ox, oy, Math.PI / 4],
      [ox + size, oy, (Math.PI * 3) / 4],
      [ox + size, oy + size, (-Math.PI * 3) / 4],
      [ox, oy + size, -Math.PI / 4],
    ];
    for (const [x, y, a] of corners) {
      branchPath(x, y, a + (rnd() - 0.5) * 0.3, s * (1.5 + rnd() * 0.5), 2);
      branchPath(x, y, a + 0.55 + (rnd() - 0.5) * 0.2, s * (0.8 + rnd() * 0.3), 1);
      branchPath(x, y, a - 0.55 + (rnd() - 0.5) * 0.2, s * (0.8 + rnd() * 0.3), 1);
    }
    // Smaller crystals along the side edges.
    for (let i = 0; i < 10; i++) {
      const side = i % 4;
      const t = 0.2 + rnd() * 0.6;
      const x = side === 0 ? ox : side === 1 ? ox + size : ox + t * size;
      const y = side === 2 ? oy : side === 3 ? oy + size : oy + t * size;
      const a = (side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2) + (rnd() - 0.5) * 0.6;
      branchPath(x, y, a, s * (0.45 + rnd() * 0.4), 1);
    }
    g.strokeStyle = rgbToCss(T.d0, 0.05 * k);
    g.lineWidth = s * 0.05;
    g.stroke();
    g.strokeStyle = rgbToCss(T.d0, 0.2 * k);
    g.lineWidth = Math.max(0.75, s * 0.014);
    g.stroke();
    // Six-point snow sparkles scattered over the field.
    g.beginPath();
    for (let i = 0; i < 22; i++) {
      const x = ox + rnd() * size;
      const y = oy + rnd() * size;
      const r = s * (0.05 + rnd() * 0.06);
      for (let j = 0; j < 3; j++) {
        const a = (j * Math.PI) / 3;
        g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
    }
    g.strokeStyle = rgbToCss(T.d0, 0.18 * k);
    g.lineWidth = Math.max(0.75, s * 0.012);
    g.stroke();
    // Frosted rim: the field edges are a touch whiter.
    g.strokeStyle = rgbToCss(T.d0, 0.05 * k);
    g.lineWidth = s * 0.5;
    g.strokeRect(ox, oy, size, size);
  },

  /** madcrown: a royal diamond lattice, crown filigree in the corners and a faint crown sigil. */
  filigree(g, s, ox, oy, size, T, k) {
    // Lattice every two cells, both diagonals.
    g.beginPath();
    for (let i = -size; i <= size * 2; i += s * 2) {
      g.moveTo(ox + i, oy);
      g.lineTo(ox + i + size, oy + size);
      g.moveTo(ox + i, oy + size);
      g.lineTo(ox + i + size, oy);
    }
    g.strokeStyle = rgbToCss(T.d0, 0.045 * k);
    g.lineWidth = Math.max(0.75, s * 0.012);
    g.stroke();
    // Corner filigree: a pair of mirrored scrolls (log spirals) and dots, per corner.
    const scroll = (sgn: number): void => {
      g.moveTo(0, 0);
      for (let i = 1; i <= 26; i++) {
        const t = i / 26;
        const a = t * Math.PI * 2.4;
        const r = s * 0.95 * (1 - t * 0.78);
        const cx = s * 1.05;
        g.lineTo(cx - Math.cos(a) * r, sgn * (Math.sin(a) * r * 0.9 + t * s * 0.15));
      }
    };
    const corners: [number, number, number][] = [
      [ox, oy, 0],
      [ox + size, oy, Math.PI / 2],
      [ox + size, oy + size, Math.PI],
      [ox, oy + size, -Math.PI / 2],
    ];
    for (const [x, y, rot] of corners) {
      g.save();
      g.translate(x, y);
      g.rotate(rot + Math.PI / 4);
      g.beginPath();
      scroll(1);
      scroll(-1);
      glowStroke(g, s, T.d0, mixRgb(T.d0, WHITE, 0.4), 0.55 * k, 0.8);
      g.fillStyle = rgbToCss(T.d1, 0.32 * k);
      for (const d of [0.35, 0.6, 2.1]) {
        g.beginPath();
        g.arc(s * d, 0, s * 0.035, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    // Crown sigil in a ring at the centre.
    const cx = ox + size / 2;
    const cy = oy + size / 2;
    g.beginPath();
    g.arc(cx, cy, s * 1.6, 0, Math.PI * 2);
    g.moveTo(cx + s * 1.42, cy);
    g.arc(cx, cy, s * 1.42, 0, Math.PI * 2);
    g.strokeStyle = rgbToCss(T.d0, 0.09 * k);
    g.lineWidth = Math.max(0.75, s * 0.016);
    g.stroke();
    const w = s * 0.9;
    const hgt = s * 0.62;
    g.beginPath();
    g.moveTo(cx - w, cy + hgt * 0.55);
    g.lineTo(cx - w, cy - hgt * 0.45);
    g.lineTo(cx - w * 0.5, cy + hgt * 0.05);
    g.lineTo(cx, cy - hgt * 0.75);
    g.lineTo(cx + w * 0.5, cy + hgt * 0.05);
    g.lineTo(cx + w, cy - hgt * 0.45);
    g.lineTo(cx + w, cy + hgt * 0.55);
    g.closePath();
    g.fillStyle = rgbToCss(T.d1, 0.035 * k);
    g.fill();
    g.strokeStyle = rgbToCss(T.d1, 0.12 * k);
    g.stroke();
    blob(g, cx, cy, s * 2.2, T.d0, 0.04 * k);
  },

  /** apex: a starfield (dust, glints, two faint constellations) and soft cloud wisps at the edges. */
  stars(g, s, ox, oy, size, T, k, rnd) {
    // Cloud wisps hugging the left / right / bottom edges.
    for (let i = 0; i < 12; i++) {
      const side = i % 3;
      const x = side === 0 ? ox + rnd() * s : side === 1 ? ox + size - rnd() * s : ox + rnd() * size;
      const y = side === 2 ? oy + size - rnd() * s * 0.8 : oy + size * (0.15 + rnd() * 0.7);
      blob(g, x, y, s * (0.7 + rnd() * 0.7), [0.85, 0.88, 1], 0.05 * k, 1.8);
    }
    // Star dust.
    for (let i = 0; i < 150; i++) {
      const c = rnd() < 0.7 ? T.d0 : T.d1;
      const r = s * (0.007 + rnd() * rnd() * 0.022);
      g.fillStyle = rgbToCss(c, (0.18 + rnd() * 0.4) * k);
      g.beginPath();
      g.arc(ox + rnd() * size, oy + rnd() * size, r, 0, Math.PI * 2);
      g.fill();
    }
    // Four-point glints, two of the constellations joined by faint gold lines.
    const pts: [number, number][] = [];
    for (let i = 0; i < 14; i++) {
      const x = ox + rnd() * size;
      const y = oy + rnd() * size;
      pts.push([x, y]);
      const L = s * (0.09 + rnd() * 0.12);
      const lg = g.createRadialGradient(x, y, 0, x, y, L);
      lg.addColorStop(0, rgbToCss(mixRgb(T.d0, WHITE, 0.5), 0.6 * k));
      lg.addColorStop(1, rgbToCss(T.d0, 0));
      g.strokeStyle = lg;
      g.lineWidth = Math.max(0.75, s * 0.014);
      g.beginPath();
      g.moveTo(x - L, y);
      g.lineTo(x + L, y);
      g.moveTo(x, y - L);
      g.lineTo(x, y + L);
      g.stroke();
    }
    g.beginPath();
    for (const set of [
      [0, 3, 5, 8],
      [1, 6, 9, 11, 13],
    ]) {
      set.forEach((i, j) => (j === 0 ? g.moveTo(pts[i][0], pts[i][1]) : g.lineTo(pts[i][0], pts[i][1])));
    }
    g.strokeStyle = rgbToCss(T.grid, 0.06 * k);
    g.lineWidth = Math.max(0.75, s * 0.01);
    g.stroke();
    // Warm starlight at the centre.
    blob(g, ox + size / 2, oy + size / 2, s * 3, T.grid, 0.03 * k);
  },
};

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
  // Copy the pixel into a 1x1 scratch canvas and read that one back, so the (GPU-backed) source
  // canvas itself is never read back (repeated readbacks demote it to a slow CPU canvas).
  try {
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!probe) return -1;
    probe.canvas.width = 1;
    probe.canvas.height = 1;
    probe.clearRect(0, 0, 1, 1);
    probe.drawImage(g.canvas, Math.round(x), Math.round(y), 1, 1, 0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data[3] / 255;
  } catch {
    return -1;
  }
}
let probe: CanvasRenderingContext2D | null | undefined;

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
