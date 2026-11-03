/**
 * Design tokens shared by the 3D board and the 2D fallback.
 * "Bright Arena" (docs/design/arena-style.md): a daylight grass field of chunky raised tiles on a
 * warm stone plinth, sitting on the app's sky-blue background. Values marked (doc) are the shared
 * palette of that document, so the board matches the UI exactly.
 * All values are sRGB hex strings so they can be used directly in CSS.
 */
import type { CharacterId, PlayerId, Rarity } from '../engine/types';

export interface TeamColors {
  /** Main body color of pieces / primary accent for the team. */
  main: string;
  /** Lighter tone (rim light, rings, accents). */
  light: string;
  /** Darker tone (pips, outlines, pressed states). */
  dark: string;
  /** Very pale container tone (chips, UI surfaces). */
  container: string;
  /** Readable text color on `main`. */
  onMain: string;
  /** Bright tone used for FX glows (landing rings, dissolve edges). */
  glow: string;
  /** Home-zone tint colour (blended at ~22-30 % over the grass tiles). */
  zone: string;
}

export const TEAM_COLORS: Record<PlayerId, TeamColors> = {
  // team-blue (doc): #3c8dff, light #8cc2ff, deep #1f56c4; blue-zone #6fb3ff.
  0: {
    main: '#3C8DFF',
    light: '#8CC2FF',
    dark: '#1F56C4',
    container: '#D6E8FF',
    onMain: '#FFFFFF',
    glow: '#5AA8FF',
    zone: '#6FB3FF',
  },
  // team-red (doc): #ff4d57, light #ff9aa0, deep #c4212c; red-zone #ff7a7a.
  1: {
    main: '#FF4D57',
    light: '#FF9AA0',
    dark: '#C4212C',
    container: '#FFD9DB',
    onMain: '#FFFFFF',
    glow: '#FF6670',
    zone: '#FF7A7A',
  },
};

export const TEAM_NAMES: Record<PlayerId, { en: string; ko: string }> = {
  0: { en: 'Blue', ko: '블루' },
  1: { en: 'Red', ko: '레드' },
};

/**
 * Rarity accent colours (owner spec): common = clean white, rare = orange, epic = purple,
 * legendary = gold (its ring under the unit sweeps through a rainbow instead, see RARITY_RING).
 */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#EEF2F8',
  rare: '#FF9A2E',
  epic: '#B65CFF',
  legendary: '#FFC94A',
};

/**
 * Rarity ring drawn on the ground around every unit (both views): solid core colour, glow colour
 * and glow strength. `rainbow` rings sweep the hue around the ring and rotate slowly.
 */
export const RARITY_RING: Record<Rarity, { core: string; glow: string; glowAmt: number; rainbow: boolean }> = {
  // On the bright grass the rings are solid bands with navy keylines; glow only for real emphasis.
  common: { core: '#FFFFFF', glow: '#FFFFFF', glowAmt: 0.0, rainbow: false },
  rare: { core: '#FF9A2E', glow: '#FFB24A', glowAmt: 0.35, rainbow: false },
  epic: { core: '#B65CFF', glow: '#C98BFF', glowAmt: 0.4, rainbow: false },
  legendary: { core: '#FFFFFF', glow: '#FFFFFF', glowAmt: 0.55, rainbow: true },
};

/**
 * Per-character strike / skill FX colours (sRGB hex), shared by both views:
 * sad = holy gold, marki = molten orange + dust, walk = shield blue-white, insaner = violet/crimson,
 * brutile = sickly toxic green over black-purple (witch curse).
 */
export const CHARACTER_FX: Record<CharacterId, { primary: string; secondary: string; core: string }> = {
  sad: { primary: '#FFC93A', secondary: '#FFF0B8', core: '#FFFFFF' },
  marki: { primary: '#FF6A1F', secondary: '#C9B9A0', core: '#FFE2B0' },
  walk: { primary: '#7CC8FF', secondary: '#DDF2FF', core: '#FFFFFF' },
  insaner: { primary: '#B24BFF', secondary: '#FF2A5C', core: '#F4DCFF' },
  brutile: { primary: '#6BFF3A', secondary: '#5B1F86', core: '#E8FFC2' },
};

/**
 * Brutile's wasteland ("불모지"): cracked dark purple-green earth split by sickly green glowing
 * cracks, bubbling poison and a faint green miasma — a dark patch that reads clearly on the bright
 * grass. Kept clear of the storm's purple haze and of the white / red move and capture markers.
 * `invalid` = red ghost of a forbidden skill placement.
 */
export const WASTE_COLORS = {
  /** Cursed earth: dark plum mottled with dark moss green. */
  ground: '#3A2648',
  groundEdge: '#2F4224',
  /** Glowing crack / poison colour and its hot core. */
  glow: '#62FF2E',
  core: '#E4FFB0',
  /** Deep toxic green of the miasma / bubbles. */
  miasma: '#2FAE1E',
  /** Black-purple curse tone (cast rune, dissolve smoke). */
  curse: '#5B1F86',
  /** Skill targeting: anchor frame (deep plum, reads on grass), valid ghost, invalid ghost. */
  anchor: '#3D1A5C',
  ghost: '#8CFF4A',
  invalid: '#FF3B4E',
  /** Danger mark on deadly move targets. */
  danger: '#FF4A4A',
  /** Tile tint under the wasteland. */
  tile: '#2E2236',
} as const;

export const RARITY_LABELS: Record<Rarity, { en: string; ko: string }> = {
  common: { en: 'Common', ko: '일반' },
  rare: { en: 'Rare', ko: '희귀' },
  epic: { en: 'Epic', ko: '에픽' },
  legendary: { en: 'Legendary', ko: '전설' },
};

/** Glow strength (0..1) of each rarity's ring and floor halo. */
export const RARITY_GLOW: Record<Rarity, number> = {
  common: 0.35,
  rare: 0.7,
  epic: 0.85,
  legendary: 1,
};

/**
 * Character -> rarity, kept locally so the renderer does not depend on the engine's
 * runtime data. Must match CHARACTERS in src/engine.
 */
export const CHARACTER_RARITY: Record<CharacterId, Rarity> = {
  sad: 'common',
  marki: 'rare',
  walk: 'epic',
  insaner: 'legendary',
  brutile: 'legendary',
};

/**
 * "Bright Arena" board surfaces (doc palette): grass tiles, stone plinth, sky background.
 * The canvas itself is transparent: the page paints the sky gradient behind the board.
 */
export const ARENA = {
  skyTop: '#4F8EE8',
  skyBottom: '#2A59B8',
  navy: '#1B2445',
  grassLight: '#8FD16A',
  grassDark: '#79BF57',
  /** Field bed seen between the tiles (a deeper grass) and its shaded tone. */
  bed: '#4F963A',
  bedDeep: '#3B7A2C',
  stone: '#C9B48E',
  stoneLight: '#E3D3B0',
  stoneDeep: '#8F7A57',
  /** Darkest stone (bottom of the plinth lip). */
  stoneShadow: '#6B5A3E',
  /** Soft cream of the centre path. */
  path: '#FFF6D8',
  gold: '#FFCF3A',
  goldDeep: '#F29A16',
} as const;

export const BOARD_COLORS = {
  /** Opaque fallback behind the board (only used where a transparent clear is impossible). */
  background: ARENA.skyBottom,
  /** Plinth stone (legacy tilted 3D slab). */
  slab: ARENA.stone,
  slabEdge: ARENA.stoneDeep,
  gap: ARENA.bed,
  /** Two-tone grass tiles (doc grass-light / grass-dark). */
  tileLight: ARENA.grassLight,
  tileDark: ARENA.grassDark,
  /** Own move target: soft white dot with a dark drop shadow. */
  moveDot: '#FFFFFF',
  moveDotAlpha: 1,
  /** Enemy reach preview (tone 'enemy'): red move markers, selection ring and tile tints. */
  enemyMoveDot: '#FF4D57',
  enemySelected: '#FF4D57',
  enemySelectedTint: '#FF9AA0',
  enemyMoveTint: '#FF9AA0',
  /** Capture target ring + tile tint. */
  capture: '#FF3B47',
  captureTint: '#FF6B6B',
  /** Selected square ring (gold) + tile tint (pale gold). */
  selected: '#FFD23F',
  selectedTint: '#FFF0A0',
  /** Last move from/to tint (warm gold). */
  lastMove: '#FFCF3A',
  /** Dark metal puck under every piece (legacy tilted view). */
  pieceBase: '#3B4A72',
  /** Level pips (gold). */
  pip: '#FFCF3A',
  shadow: ARENA.navy,
} as const;

/** Strength (0..1) of the always-on home-zone team tint on the tiles (doc: ~22 %). */
export const HOME_TINT_STRENGTH = 0.22;
/** Strength (0..1) of the highlighted zoneRows tint. */
export const ZONE_TINT_STRENGTH = 0.45;
/** Strength (0..1) of the last-move tint. */
export const LAST_MOVE_TINT_STRENGTH = 0.34;

/** Animation timings (ms) shared by both views. All effects stay <= ~450 ms. */
export const ANIM = {
  slideMin: 250,
  slideMax: 320,
  jump: 400,
  capture: 240,
  /** Walk landing squash. */
  land: 120,
  /** Expanding ring / pulse at the landing square. */
  pulse: 420,
  /** Capture impact flash. */
  flash: 220,
  /** Camera micro-shake. */
  shake: 120,
  shakePx: 2.5,
  /** Zone-edge sweep when the turn changes. */
  turn: 450,
} as const;
