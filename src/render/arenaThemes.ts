/**
 * Per-arena board themes (both views). Every arena keeps the same board structure and readability
 * rules (docs/design/progression.md "Arena themes and music"): dark low-contrast cells, thin glowing
 * grid lines, a slim bezel with HUD corner brackets, blue / red home zones and the shared marker /
 * FX palette (palette.ts), which every theme leaves untouched. What changes per arena is the
 * material of the field:
 *  - the cell base colours, the field bed and the bezel (face, top light, lip, hairline);
 *  - the grid line colour, its bright core and glow strength;
 *  - the accent bars and the corner brackets (plus a small corner jewel on some arenas);
 *  - one procedural surface detail painted into the static field overlay (arena.ts
 *    paintSurfaceDetail): moonlit rune circle, ember cracks, moss / fog mottling, frost crystals and
 *    an aurora veil, crown filigree, a starfield;
 *  - an optional light ambient particle drift (ambient.ts): embers, spores, snow, demon-fire motes,
 *    star twinkles.
 * moonrune is the original v6 "tactical hologram" look (values identical to palette.ts ARENA / HOLO
 * and BOARD_COLORS.tileLight / tileDark), and the fallback for any unknown id.
 *
 * Readability budget (checked on every theme): cells stay dark (sRGB luma < 0.15) so the ice-cyan move
 * dots, the red capture ring, the gold last-move tint, the green wasteland, the violet storm haze and
 * the team colours keep their contrast; surface details stay under ~0.2 alpha and are painted under
 * every marker. Pure data: no three.js, no DOM.
 */
import { ARENA, BOARD_COLORS, HOLO, HOME_TINT_STRENGTH } from './palette';

/** Arena ids with a board theme (same ids as the progression arenas, kept local to the renderer). */
export const BOARD_THEME_IDS = ['moonrune', 'emberforge', 'blightmire', 'frostkeep', 'madcrown', 'apex'] as const;
export type BoardThemeId = (typeof BOARD_THEME_IDS)[number];

/** Procedural surface detail painted once into the field overlay. */
export type SurfaceDetail = 'runes' | 'cracks' | 'moss' | 'frost' | 'filigree' | 'stars';

/** Ambient particle behaviour (ambient.ts). */
export type AmbientKind = 'motes' | 'embers' | 'spores' | 'snow' | 'twinkle';

export interface AmbientSpec {
  kind: AmbientKind;
  /** Number of particles (both views draw at most AMBIENT_MAX). */
  count: number;
  /** Two colours; each particle picks one (sRGB hex). */
  colors: readonly [string, string];
  /** Particle diameter in cells. */
  size: number;
  /** Drift speed in cells per second along the kind's direction (up / down the screen). */
  speed: number;
  /** Peak opacity (0..1). */
  alpha: number;
}

export interface BoardTheme {
  id: BoardThemeId;
  /** Two-tone cell base colours (sRGB hex), dark = (r + c) even. */
  tileLight: string;
  tileDark: string;
  /** Multiplier on HOME_TINT_STRENGTH: warm / tinted fields need a firmer blue / red home tint. */
  homeTint: number;
  /** Brightness multiplier of the gold last-move tint (1 = original; warm / gold fields need more). */
  lastMoveBoost: number;
  /** Field bed seen between the cells. */
  bed: string;
  /** Bezel: face, top light, lip / shadow tone, hairline. */
  bezel: { face: string; top: string; lip: string; line: string };
  /** Grid line colour and its bright core tone (also the scan sweep and the ruler ticks). */
  grid: string;
  gridCore: string;
  /** Overlay strengths (alpha), defaults = palette HOLO. */
  holo: {
    gridCore: number;
    gridGlow: number;
    gridMajor: number;
    /** Hex micro-texture (0 = none). */
    hex: number;
    centreGlow: number;
    zoneWashEdge: number;
    zoneWashBack: number;
    /** WebGL scan sweep peak alpha. */
    scan: number;
  };
  /** How far the grid lines inside the home zones lean to the team glow: [blue, red]. */
  zoneGridMix: readonly [number, number];
  /** Accent bars mid-side on the bezel: bright and deep tone. */
  accent: string;
  accentDeep: string;
  /** HUD corner brackets: glow tone and core line. */
  bracket: string;
  bracketCore: string;
  /** Small ornament at each bezel corner, inside the bracket (none on the hologram look). */
  jewel: 'none' | 'diamond' | 'rivet' | 'star' | 'crystal';
  /** Surface detail and its two tones (sRGB hex) and strength (0..1 scales its alphas). */
  detail: SurfaceDetail;
  detailColors: readonly [string, string];
  detailStrength: number;
  /** Ambient particles, null = none. */
  ambient: AmbientSpec | null;
}

const MOONRUNE: BoardTheme = {
  id: 'moonrune',
  tileLight: BOARD_COLORS.tileLight,
  tileDark: BOARD_COLORS.tileDark,
  homeTint: 1,
  lastMoveBoost: 1,
  bed: ARENA.bed,
  bezel: { face: ARENA.bezel, top: ARENA.ironTop, lip: ARENA.ironLip, line: ARENA.line },
  grid: ARENA.grid,
  gridCore: ARENA.gridCore,
  holo: { ...HOLO },
  zoneGridMix: [0.45, 0.75],
  accent: ARENA.gold,
  accentDeep: ARENA.goldDeep,
  bracket: ARENA.grid,
  bracketCore: ARENA.gridCore,
  jewel: 'none',
  // Cold moonlight: a faint rune circle etched around the centre, pale moon-silver glyphs.
  detail: 'runes',
  detailColors: ['#9FD8FF', '#E4F1FF'],
  detailStrength: 1,
  ambient: { kind: 'motes', count: 10, colors: ['#CFE6FF', '#9FC8FF'], size: 0.075, speed: 0.1, alpha: 0.3 },
};

const EMBERFORGE: BoardTheme = {
  id: 'emberforge',
  // Soot-black iron plates with a warm brown cast.
  tileLight: '#1D1612',
  tileDark: '#17110E',
  homeTint: 1.4,
  lastMoveBoost: 1.7,
  bed: '#070403',
  bezel: { face: '#1A110D', top: '#4A3022', lip: '#080403', line: '#5E3A24' },
  grid: '#FF8A3D',
  gridCore: '#FFD3A1',
  holo: { gridCore: 0.26, gridGlow: 0.085, gridMajor: 0.4, hex: 0, centreGlow: 0.05, zoneWashEdge: 0.17, zoneWashBack: 0.03, scan: 0.05 },
  zoneGridMix: [0.8, 0.6],
  accent: '#FF7A2A',
  accentDeep: '#9E3A0E',
  bracket: '#FF7A2A',
  bracketCore: '#FFD9A8',
  jewel: 'rivet',
  // Molten cracks glowing through the plates.
  detail: 'cracks',
  detailColors: ['#FF6A1F', '#FFC266'],
  detailStrength: 1,
  ambient: { kind: 'embers', count: 24, colors: ['#FF7A2A', '#FFC266'], size: 0.06, speed: 0.42, alpha: 0.85 },
};

const BLIGHTMIRE: BoardTheme = {
  id: 'blightmire',
  // Bog-black green stone (the wasteland stays apart: black-green ground split by bright lime cracks).
  tileLight: '#13221A',
  tileDark: '#0F1C15',
  homeTint: 1.45,
  lastMoveBoost: 1.3,
  bed: '#030805',
  bezel: { face: '#0C1610', top: '#2A4632', lip: '#040906', line: '#38583E' },
  // Murky jade grid.
  grid: '#5ED89A',
  gridCore: '#D2FFE4',
  holo: { gridCore: 0.24, gridGlow: 0.08, gridMajor: 0.38, hex: 0, centreGlow: 0.03, zoneWashEdge: 0.16, zoneWashBack: 0.03, scan: 0.045 },
  zoneGridMix: [0.7, 0.75],
  // Witch-lantern amber accents and brackets.
  accent: '#E2D46A',
  accentDeep: '#7A6A1E',
  bracket: '#D8D46A',
  bracketCore: '#FFF6C8',
  jewel: 'diamond',
  // Moss and fog mottling, creeping roots and a few witch-lantern glows.
  detail: 'moss',
  detailColors: ['#9FE8C0', '#06120B'],
  detailStrength: 1,
  ambient: { kind: 'spores', count: 22, colors: ['#C8F08A', '#9FE8C0'], size: 0.085, speed: 0.14, alpha: 0.6 },
};

const FROSTKEEP: BoardTheme = {
  id: 'frostkeep',
  // Glacial slate: a touch lighter and greyer than moonrune's navy.
  tileLight: '#15283A',
  tileDark: '#112131',
  homeTint: 1.15,
  lastMoveBoost: 1.1,
  bed: '#040A12',
  bezel: { face: '#142235', top: '#46607E', lip: '#070D16', line: '#5A7898' },
  // Aurora aqua grid.
  grid: '#8CF2E6',
  gridCore: '#ECFFFC',
  holo: { gridCore: 0.28, gridGlow: 0.08, gridMajor: 0.42, hex: 0, centreGlow: 0.05, zoneWashEdge: 0.13, zoneWashBack: 0.02, scan: 0.06 },
  zoneGridMix: [0.4, 0.75],
  // Silver instead of gold.
  accent: '#E6F2FF',
  accentDeep: '#7F9FC4',
  bracket: '#BFF6FF',
  bracketCore: '#FFFFFF',
  jewel: 'crystal',
  // Frost crystals creeping in from the edges and a faint aurora veil.
  detail: 'frost',
  detailColors: ['#E8F8FF', '#7CF5C8'],
  detailStrength: 1,
  ambient: { kind: 'snow', count: 28, colors: ['#FFFFFF', '#D6F1FF'], size: 0.06, speed: 0.32, alpha: 0.7 },
};

const MADCROWN: BoardTheme = {
  id: 'madcrown',
  // Deep plum velvet (dark enough that the violet storm haze still reads on it).
  tileLight: '#1A1029',
  tileDark: '#150C22',
  homeTint: 1.3,
  lastMoveBoost: 1.3,
  bed: '#07030D',
  bezel: { face: '#170C22', top: '#432653', lip: '#07030C', line: '#5E3A7C' },
  grid: '#B86CFF',
  gridCore: '#EED8FF',
  holo: { gridCore: 0.26, gridGlow: 0.08, gridMajor: 0.4, hex: 0, centreGlow: 0.05, zoneWashEdge: 0.15, zoneWashBack: 0.025, scan: 0.05 },
  zoneGridMix: [0.65, 0.7],
  // Crimson-gold regalia.
  accent: '#FF4A6A',
  accentDeep: '#8E1838',
  bracket: '#C77BFF',
  bracketCore: '#FFE0F0',
  jewel: 'diamond',
  // Crown filigree in the corners, a faint crown sigil and a royal lattice.
  detail: 'filigree',
  detailColors: ['#C77BFF', '#FF5A7A'],
  detailStrength: 1,
  ambient: { kind: 'embers', count: 16, colors: ['#C06CFF', '#FF4A6A'], size: 0.065, speed: 0.26, alpha: 0.6 },
};

const APEX: BoardTheme = {
  id: 'apex',
  // Night sky above the clouds: deep indigo.
  tileLight: '#141834',
  tileDark: '#10132B',
  homeTint: 1.1,
  lastMoveBoost: 1.5,
  bed: '#04050F',
  bezel: { face: '#12142A', top: '#4A4466', lip: '#06061A', line: '#7A6430' },
  // Gold and starlight.
  grid: '#F2C14E',
  gridCore: '#FFF2C8',
  holo: { gridCore: 0.27, gridGlow: 0.08, gridMajor: 0.42, hex: 0, centreGlow: 0.06, zoneWashEdge: 0.14, zoneWashBack: 0.025, scan: 0.055 },
  zoneGridMix: [0.7, 0.8],
  accent: '#FFE6A0',
  accentDeep: '#B07A18',
  bracket: '#F2C14E',
  bracketCore: '#FFF7DC',
  jewel: 'star',
  // A starfield with soft cloud wisps at the edges.
  detail: 'stars',
  detailColors: ['#FFF6D8', '#BFD4FF'],
  detailStrength: 1,
  ambient: { kind: 'twinkle', count: 22, colors: ['#FFF3C4', '#FFFFFF'], size: 0.09, speed: 0.04, alpha: 0.85 },
};

export const BOARD_THEMES: Readonly<Record<BoardThemeId, BoardTheme>> = {
  moonrune: MOONRUNE,
  emberforge: EMBERFORGE,
  blightmire: BLIGHTMIRE,
  frostkeep: FROSTKEEP,
  madcrown: MADCROWN,
  apex: APEX,
};

/** The original hologram look (moonrune): the default of every painter. */
export const DEFAULT_BOARD_THEME: BoardTheme = MOONRUNE;

export function isBoardThemeId(id: unknown): id is BoardThemeId {
  return typeof id === 'string' && (BOARD_THEME_IDS as readonly string[]).includes(id);
}

/** The board theme of an arena id; unknown / missing ids get the default (moonrune). */
export function boardTheme(id: string | null | undefined): BoardTheme {
  return isBoardThemeId(id) ? BOARD_THEMES[id] : DEFAULT_BOARD_THEME;
}

/** HOME_TINT_STRENGTH scaled by a theme (tileRgb). */
export const homeTintOf = (t: BoardTheme): number => HOME_TINT_STRENGTH * t.homeTint;
