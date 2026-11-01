/**
 * Design tokens shared by the 3D board, the 2D fallback and (optionally) the UI.
 * Material 3-inspired: light neutrals, calm accents, Google-style team colors.
 * All values are sRGB hex strings so they can be used directly in CSS.
 */
import type { CharacterId, PlayerId, Rarity } from '../engine/types';

export interface TeamColors {
  /** Main body color of pieces / primary accent for the team. */
  main: string;
  /** Lighter tone (rings, accents). */
  light: string;
  /** Darker tone (pips, outlines, pressed states). */
  dark: string;
  /** Very pale container tone (home-zone tint, chips). */
  container: string;
  /** Readable text color on `main`. */
  onMain: string;
}

export const TEAM_COLORS: Record<PlayerId, TeamColors> = {
  0: { main: '#1A73E8', light: '#8AB4F8', dark: '#174EA6', container: '#D2E3FC', onMain: '#FFFFFF' },
  1: { main: '#D93025', light: '#F28B82', dark: '#A50E0E', container: '#FAD2CF', onMain: '#FFFFFF' },
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

/**
 * Character -> rarity, kept locally so the renderer does not depend on the engine's
 * runtime data. Must match CHARACTERS in src/engine.
 */
export const CHARACTER_RARITY: Record<CharacterId, Rarity> = {
  sad: 'common',
  marki: 'rare',
  walk: 'epic',
};

export const BOARD_COLORS = {
  /** Page / scene background behind the board. */
  background: '#F8F9FA',
  /** Raised slab the tiles sit on (also visible in the thin gaps). */
  slab: '#FFFFFF',
  slabEdge: '#DADCE0',
  gap: '#DADCE0',
  tileLight: '#F1F3F4',
  tileDark: '#E8EAED',
  /** Soft move-target dot (used with alpha). */
  moveDot: '#3C4043',
  moveDotAlpha: 0.26,
  /** Capture target ring + tile tint. */
  capture: '#D93025',
  captureTint: '#FAD2CF',
  /** Selected square ring + tile tint. */
  selected: '#1A73E8',
  selectedTint: '#D2E3FC',
  /** Last move from/to tint (pale yellow). */
  lastMove: '#FDE293',
  /** Pale neutral base of the pieces. */
  pieceBase: '#FFFFFF',
  pip: '#3C4043',
  shadow: '#000000',
} as const;

/** Strength (0..1) of the always-on home-zone team tint on the tiles. */
export const HOME_TINT_STRENGTH = 0.22;
/** Strength (0..1) of the highlighted zoneRows tint. */
export const ZONE_TINT_STRENGTH = 0.6;
/** Strength (0..1) of the last-move tint. */
export const LAST_MOVE_TINT_STRENGTH = 0.75;

/** Animation timings (ms) shared by both views. */
export const ANIM = {
  slideMin: 250,
  slideMax: 320,
  jump: 420,
  capture: 240,
} as const;
