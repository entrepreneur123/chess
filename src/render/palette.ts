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

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9AA0A6',
  rare: '#4285F4',
  epic: '#A142F4',
  legendary: '#F9AB00',
};

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
