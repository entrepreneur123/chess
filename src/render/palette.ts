/**
 * Design tokens shared by the 3D board, the 2D fallback and (optionally) the UI.
 * "Tactical fantasy arena": deep slate/navy stone, cool muted tiles, glowing team zones.
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
  /** Bright neon tone used for glows and the home-zone edge line. */
  glow: string;
  /** Deep tone the home-zone tiles are tinted towards. */
  zone: string;
}

export const TEAM_COLORS: Record<PlayerId, TeamColors> = {
  0: {
    main: '#1A73E8',
    light: '#8AB4F8',
    dark: '#174EA6',
    container: '#D2E3FC',
    onMain: '#FFFFFF',
    glow: '#4AA3FF',
    zone: '#2257CC',
  },
  1: {
    main: '#D93025',
    light: '#F28B82',
    dark: '#A50E0E',
    container: '#FAD2CF',
    onMain: '#FFFFFF',
    glow: '#FF5648',
    zone: '#A52A30',
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
  common: { core: '#F4F7FC', glow: '#FFFFFF', glowAmt: 0.28, rainbow: false },
  rare: { core: '#FFB050', glow: '#FF8A1C', glowAmt: 0.85, rainbow: false },
  epic: { core: '#C98BFF', glow: '#A040FF', glowAmt: 0.95, rainbow: false },
  legendary: { core: '#FFFFFF', glow: '#FFFFFF', glowAmt: 1.0, rainbow: true },
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
 * Brutile's wasteland ("불모지"): scorched black-brown ground split by sickly green glowing cracks,
 * bubbling poison and a faint green miasma. Kept clear of the storm's purple/magenta and of the
 * cyan / red move and capture markers. `invalid` = red ghost of a forbidden skill placement.
 */
export const WASTE_COLORS = {
  /** Scorched ground (dark, slightly olive). */
  ground: '#120F0A',
  groundEdge: '#2A2414',
  /** Glowing crack / poison colour and its hot core. */
  glow: '#62FF2E',
  core: '#E4FFB0',
  /** Deep toxic green of the miasma / bubbles. */
  miasma: '#2FAE1E',
  /** Black-purple curse tone (cast rune, dissolve smoke). */
  curse: '#5B1F86',
  /** Skill targeting: anchor tint, valid ghost, invalid ghost. */
  anchor: '#7DFF5A',
  ghost: '#8CFF4A',
  invalid: '#FF3B4E',
  /** Danger mark on deadly move targets. */
  danger: '#FF4A4A',
  /** Tile tint under the wasteland. */
  tile: '#1A1810',
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

export const BOARD_COLORS = {
  /** Page / scene background behind the board (see BACKDROP for the gradient). */
  background: '#070A15',
  /** Dark stone slab the tiles sit on (also visible in the gaps between tiles). */
  slab: '#121A2E',
  slabEdge: '#3A4B78',
  gap: '#0A0F1E',
  /** Two-tone muted cool tiles. */
  tileLight: '#515D79',
  tileDark: '#414B64',
  /** Soft glowing move-target dot. */
  moveDot: '#9BEBFF',
  moveDotAlpha: 0.95,
  /** Enemy reach preview (tone 'enemy'): red move markers, selection ring and tile tints. */
  enemyMoveDot: '#FF4F5E',
  enemySelected: '#FF3B4E',
  enemySelectedTint: '#B23040',
  enemyMoveTint: '#6E2A3A',
  /** Capture target ring + tile tint. */
  capture: '#FF4A4A',
  captureTint: '#8C2A3A',
  /** Selected square ring + tile tint. */
  selected: '#6FD2FF',
  selectedTint: '#3F7BE0',
  /** Last move from/to tint (warm gold). */
  lastMove: '#F6C453',
  /** Dark metal puck under every piece (lets the rarity ring and team body pop). */
  pieceBase: '#3B4A72',
  /** Level pips (emissive gold). */
  pip: '#FFD36B',
  shadow: '#000000',
} as const;

/** Strength (0..1) of the always-on home-zone team tint on the tiles. */
export const HOME_TINT_STRENGTH = 0.5;
/** Strength (0..1) of the highlighted zoneRows tint. */
export const ZONE_TINT_STRENGTH = 0.55;
/** Strength (0..1) of the last-move tint. */
export const LAST_MOVE_TINT_STRENGTH = 0.5;

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

/** Backdrop behind the 3D board: dark radial gradient with faint team glows at the top/bottom. */
export const BACKDROP = {
  center: '#1B2546',
  edge: '#05070F',
  /** Strength of the team-colored glows (0 = none). */
  teamGlow: 0.42,
};
