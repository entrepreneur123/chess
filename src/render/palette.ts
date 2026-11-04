/**
 * Design tokens shared by the 3D board and the 2D fallback.
 * "Dark Arena" (docs/design/dark-arena.md): dark slate / obsidian bevelled tiles in a dark iron
 * frame with a thin gold trim, floating on the app's dark backdrop; team zones, markers and FX are
 * the light sources. Values marked (doc) are the shared palette of that document, so the board
 * matches the UI exactly.
 * All values are sRGB hex strings so they can be used directly in CSS.
 */
import type { CharacterId, PlayerId, Rarity } from '../engine/types';

/**
 * Characters every table below lists explicitly. Rakaeli is added on top through a cast, so these
 * tables compile whether or not `CharacterId` already contains 'rakaeli'.
 */
type CoreCharacterId = Exclude<CharacterId, 'rakaeli'>;

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
  /** Deep tone the home-zone tiles are tinted towards (doc: team deep). */
  zone: string;
}

export const TEAM_COLORS: Record<PlayerId, TeamColors> = {
  // team-blue (doc): #3b8bff, light #8cc2ff, glow #5fb0ff, deep #1a4fb8.
  0: {
    main: '#3B8BFF',
    light: '#8CC2FF',
    dark: '#1A4FB8',
    container: '#D6E8FF',
    onMain: '#FFFFFF',
    glow: '#5FB0FF',
    zone: '#1A4FB8',
  },
  // team-red (doc): #ff4655, light #ff9aa0, glow #ff6a5a, deep #9e1c27.
  1: {
    main: '#FF4655',
    light: '#FF9AA0',
    dark: '#9E1C27',
    container: '#FFD9DB',
    onMain: '#FFFFFF',
    glow: '#FF6A5A',
    zone: '#9E1C27',
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
  // On the dark tiles the rings glow softly (doc rarity colours); common stays a clean white band.
  common: { core: '#EEF2FF', glow: '#FFFFFF', glowAmt: 0.22, rainbow: false },
  rare: { core: '#FF9A2E', glow: '#FF8A1C', glowAmt: 0.8, rainbow: false },
  epic: { core: '#B65CFF', glow: '#A040FF', glowAmt: 0.9, rainbow: false },
  legendary: { core: '#FFFFFF', glow: '#FFFFFF', glowAmt: 0.95, rainbow: true },
};

/**
 * Per-character strike / skill FX colours (sRGB hex), shared by both views:
 * sad = holy gold, marki = molten orange + dust, walk = shield blue-white, insaner = violet/crimson,
 * brutile = sickly toxic green over black-purple (witch curse).
 */
const CORE_FX: Record<CoreCharacterId, { primary: string; secondary: string; core: string }> = {
  sad: { primary: '#FFC93A', secondary: '#FFF0B8', core: '#FFFFFF' },
  marki: { primary: '#FF6A1F', secondary: '#C9B9A0', core: '#FFE2B0' },
  walk: { primary: '#7CC8FF', secondary: '#DDF2FF', core: '#FFFFFF' },
  insaner: { primary: '#B24BFF', secondary: '#FF2A5C', core: '#F4DCFF' },
  brutile: { primary: '#6BFF3A', secondary: '#5B1F86', core: '#E8FFC2' },
  // Michelle: pale doll lavender over a dusk plum. Picker: desert sun amber and rope tan.
  michelle: { primary: '#B9A6FF', secondary: '#4B3B6E', core: '#F3EEFF' },
  picker: { primary: '#FFB547', secondary: '#C9894A', core: '#FFF1D6' },
};

/**
 * Rakaeli's base form: pale ash feathers and a dim halo gold. His transformed form ("타천") uses
 * RAKAELI_AWAKE_FX instead: crimson flame, violet aura, a white-hot core.
 */
export const CHARACTER_FX = {
  ...CORE_FX,
  rakaeli: { primary: '#D9D3E0', secondary: '#C9B57A', core: '#FFFFFF' },
} as Record<CharacterId, { primary: string; secondary: string; core: string }>;
export const RAKAELI_AWAKE_FX = { primary: '#FF2742', secondary: '#9A3CFF', core: '#FFE0D4' } as const;

/**
 * Brutile's wasteland ("불모지"): cracked black-green earth split by sickly toxic-green glowing
 * cracks, bubbling poison and a faint green miasma; on the dark tiles the glow carries it. Kept
 * clear of the storm's violet haze and of the ice-cyan / red move and capture markers.
 * `invalid` = red ghost of a forbidden skill placement.
 */
export const WASTE_COLORS = {
  /** Cursed earth: black-green, mottled with dark moss. */
  ground: '#0E130B',
  groundEdge: '#26341A',
  /** Glowing crack / poison colour and its hot core. */
  glow: '#62FF2E',
  core: '#E4FFB0',
  /** Deep toxic green of the miasma / bubbles. */
  miasma: '#2FAE1E',
  /** Black-purple curse tone (cast rune, dissolve smoke). */
  curse: '#5B1F86',
  /** Skill targeting: anchor frame (toxic green glow), valid ghost, invalid ghost. */
  anchor: '#7CFF5A',
  ghost: '#8CFF4A',
  invalid: '#FF3B4E',
  /** Danger mark on deadly move targets. */
  danger: '#FF4A4A',
  /** Tile tint under the wasteland. */
  tile: '#121A10',
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
export const CHARACTER_RARITY = {
  rakaeli: 'epic',
  sad: 'common',
  marki: 'rare',
  walk: 'epic',
  insaner: 'legendary',
  brutile: 'legendary',
  michelle: 'common',
  picker: 'rare',
} satisfies Record<CoreCharacterId, Rarity> & { rakaeli: Rarity } as Record<CharacterId, Rarity>;

/**
 * Board surfaces (doc palette). v6 "tactical hologram" (docs/design/v6-clean-tactical.md): a slim
 * dark bezel with HUD corner brackets and thin gold accents around a deep-navy field of flat,
 * low-contrast cells, split by thin glowing cyan grid lines over a faint hex micro-texture.
 * The canvas itself is transparent: the page paints its dark backdrop behind the board.
 */
export const ARENA = {
  /** night-0 / night-1 (doc): deepest background and the app base. */
  night0: '#070A12',
  night1: '#0D1322',
  /** Bezel: panel (doc) body, panel-top light edge, panel-lip bottom lip / shadow. */
  iron: '#1B2338',
  ironTop: '#28324D',
  ironLip: '#090D17',
  /** Bezel face (darker than a UI panel so the field reads as a lit screen inside it). */
  bezel: '#0A1020',
  /** Hairline (doc line). */
  line: '#33405F',
  /** Field bed seen between the cells (under the grid lines). */
  bed: '#060B17',
  /** Hologram grid / HUD line cyan and its bright core tone. */
  grid: '#5FD0FF',
  gridCore: '#BDEFFF',
  /** Gold trim (doc gold / gold-deep / gold-lip). */
  gold: '#F2C14E',
  goldDeep: '#C8891E',
  goldLip: '#6E4510',
} as const;

/**
 * Hologram field overlay strengths (alpha, 0..1), shared by both views (arena.ts paintFieldOverlay):
 * grid line core / glow, hex micro-texture, the centre projection glow and the home-zone wash.
 */
export const HOLO = {
  gridCore: 0.3,
  gridGlow: 0.075,
  /** Major lines (zone edges are drawn separately; this is the centre line). */
  gridMajor: 0.42,
  hex: 0.05,
  centreGlow: 0.055,
  /** Team wash in the home zone: strongest at the zone edge line, fading toward the back rank. */
  zoneWashEdge: 0.13,
  zoneWashBack: 0.02,
  /** Ambient scanline shimmer (WebGL only, off with reduced motion): peak additive alpha. */
  scan: 0.055,
} as const;

export const BOARD_COLORS = {
  /** Opaque fallback behind the board (only used where a transparent clear is impossible). */
  background: ARENA.night1,
  /** Dark stone slab (legacy tilted 3D view) and its inlaid frame. */
  slab: '#121A2E',
  slabEdge: '#3A4B78',
  gap: ARENA.bed,
  /** Two-tone deep-navy hologram cells, very low contrast (v6: about #0d1830 / #0b1428). */
  tileLight: '#0E1A33',
  tileDark: '#0B1529',
  /** Own move target: luminous ice-cyan dot (additive glow, white-hot core). */
  moveDot: '#9BEBFF',
  /** Enemy reach preview (tone 'enemy'): red glowing dots, selection frame and tile tints. */
  enemyMoveDot: '#FF5363',
  enemySelected: '#FF4655',
  enemySelectedTint: '#8E2436',
  enemyMoveTint: '#4A1C2C',
  /** Capture target ring (glowing red) + tile tint. */
  capture: '#FF4655',
  captureTint: '#6A1E2C',
  /** Selected square: ice-cyan glowing frame + a cool blue tile tint. */
  selected: '#7FE3FF',
  selectedTint: '#3C83C8',
  /** Last move from/to tint (candle gold). */
  lastMove: '#F2C14E',
  /** Dark metal puck under every piece (legacy tilted view). */
  pieceBase: '#3B4A72',
  /** Level pips (gold). */
  pip: '#F2C14E',
  shadow: ARENA.night0,
} as const;

/**
 * Strength (0..1) of the always-on home-zone team-deep tint on the cells (v6: a soft tint, not a
 * slab; the glow wash, the team-tinted grid and the bright edge line carry the zone).
 */
export const HOME_TINT_STRENGTH = 0.15;
/** Strength (0..1) of the highlighted zoneRows tint. */
export const ZONE_TINT_STRENGTH = 0.5;
/** Strength (0..1) of the last-move tint. */
export const LAST_MOVE_TINT_STRENGTH = 0.62;

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
