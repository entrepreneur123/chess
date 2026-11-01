/**
 * Per-character / per-level look of the glTF units (public/models/{sad,marki,walk}.glb, built by
 * docs/brand/models/build.mjs). Pure data: which prop nodes are shown, what glows, atlas re-tints,
 * scale and the Lv3 aura theme.
 */
import type { CharacterId, Level } from '../../engine/types';

/** Logical animation clip names (renamed in the asset pipeline). */
export type ClipName = 'idle' | 'run' | 'jump' | 'attack' | 'death';

/** A rectangle of the texture atlas in normalized image coordinates (u0, v0, u1, v1; v down). */
export type AtlasRect = [number, number, number, number];

export interface LevelLook {
  /** Rigid prop nodes (by glTF node name) shown at this level. Skinned body parts are always shown. */
  props: string[];
  /** Per-node emissive strength (0..1.5) for glowing props (weapon trim / legendary gear). */
  glow?: Record<string, number>;
  /** Whole-unit scale multiplier (on top of the per-character base scale). */
  scale: number;
  /** Atlas recolour of neutral metal (humanoids): gold paladin / dark arcane armour. */
  metal?: 'gold' | 'dark';
  /** Lv3 aura theme (ground glow + rising particles), if any. */
  aura?: { color: string; core: string; count: number };
  /** Team plume size (paladin only); 0 = none. */
  plume?: number;
  /** Floating halo above the head (paladin Lv3). */
  halo?: boolean;
  /** Bull: per-material-slot colour overrides (sRGB hex or 'team') and glow strengths. */
  parts?: Record<string, { color?: string; glow?: number }>;
}

export interface CharacterLook {
  file: string;
  /** World height (feet to head top) of the Lv1 unit on the board, in tile units. */
  height: number;
  /** For long quadrupeds: cap on the model length along its facing axis (tile units). */
  maxLength?: number;
  /** Atlas cells re-tinted with the team colour (normalized image rects). */
  teamCells: AtlasRect[];
  /** Neutral-metal atlas region that `metal` recolours. */
  metalRegion?: AtlasRect;
  /** Normalized time (0..1) of the attack clip's impact frame. */
  impact: number;
  /** Team rim-light strength (fresnel). */
  rim: number;
  /** Non-uniform model scale (x = width) applied on top of the fitted scale. */
  stretch?: [number, number, number];
  /** Rest-pose bone scales (sanitized glTF bone names) to stylise proportions. */
  boneScale?: Record<string, number>;
  /** Smooth the authored (faceted) normals. */
  smooth?: boolean;
  levels: Record<Level, LevelLook>;
}

/** Atlas cell helper: 8 columns x 4 rows per 256 px KayKit atlas; `half` places it in a 2:1 atlas. */
const cell = (col: number, row: number, half: 0 | 1 | null = null): AtlasRect => {
  const w = half === null ? 1 / 8 : 1 / 16;
  const u0 = (half === 1 ? 0.5 : 0) + col * w;
  return [u0, row / 4, u0 + w, (row + 1) / 4];
};

export const LOOKS: Record<CharacterId, CharacterLook> = {
  // Paladin (KayKit Knight). Team: cape + plume + heraldry cells.
  sad: {
    file: 'models/sad.glb',
    height: 1.7,
    rim: 0.5,
    teamCells: [cell(0, 1), cell(2, 2)],
    metalRegion: [0, 0, 1, 0.75],
    impact: 0.42,
    levels: {
      1: { props: ['Knight_Helmet', '1H_Sword'], scale: 1, plume: 0.9 },
      2: {
        props: ['Knight_Helmet', 'Knight_Cape', '2H_Sword', 'Pauldron_L', 'Pauldron_R'],
        glow: { '2H_Sword': 0.35 },
        scale: 1.06,
        plume: 1.05,
      },
      3: {
        props: ['Knight_Helmet', 'Knight_Cape', 'Gold_Sword', 'Pauldron_L', 'Pauldron_R'],
        glow: { Gold_Sword: 0.85 },
        scale: 1.14,
        metal: 'gold',
        plume: 1.15,
        halo: true,
        aura: { color: '#FFC94A', core: '#FFF4C9', count: 22 },
      },
    },
  },
  // Charging war bull (Quaternius). Team: heraldry on the back saddle plate (all levels) + pauldrons (Lv2+).
  marki: {
    file: 'models/marki.glb',
    height: 1.3,
    maxLength: 1.85,
    rim: 0.28,
    stretch: [1.28, 1, 1],
    boneScale: { Head: 1.3, Neck1: 1.1, Torso: 1.08, Torso2: 1.1, FrontShoulderL: 1.18, FrontShoulderR: 1.18, BackShoulderL: 1.1, BackShoulderR: 1.1 },
    smooth: true,
    teamCells: [],
    impact: 0.45,
    levels: {
      1: {
        props: ['Saddle'],
        scale: 1,
        parts: { Main: { color: '#6E4026' }, Main_Light: { color: '#A87650' }, Horns: { color: '#F2EAD6' } },
      },
      2: {
        props: ['Plate_L', 'Plate_R', 'Saddle'],
        scale: 1.06,
        parts: {
          Main: { color: '#5C3420' },
          Main_Light: { color: '#946240' },
          Horns: { color: '#B9C3CF', glow: 0.15 },
          Hooves: { color: '#3A3F48' },
        },
      },
      3: {
        props: ['Plate_L', 'Plate_R', 'Saddle_Spike'],
        scale: 1.14,
        parts: {
          Main: { color: '#33201A' },
          Main_Light: { color: '#6A3C28' },
          Horns: { color: '#FFC23A', glow: 1.2 },
          Hooves: { color: '#FFB347', glow: 0.6 },
          Eye_White: { color: '#FF7A1A', glow: 1.5 },
          Eye_Black: { color: '#FF5A00', glow: 1.2 },
        },
        aura: { color: '#FF6A1F', core: '#FFD27A', count: 24 },
      },
    },
  },
  // Shield bearer (KayKit Barbarian + knight-atlas props in the right half of a 2:1 atlas).
  walk: {
    file: 'models/walk.glb',
    height: 1.68,
    rim: 0.5,
    teamCells: [cell(0, 1, 0), cell(1, 1, 0), cell(2, 2, 0), cell(0, 1, 1), cell(2, 2, 1)],
    metalRegion: [0, 0, 1, 0.75],
    impact: 0.4,
    levels: {
      1: { props: ['Barbarian_Hat', 'Barbarian_Round_Shield', '1H_Axe'], scale: 1 },
      2: {
        props: ['Barbarian_Hat', 'Pauldron_L', 'Pauldron_R', 'Kite_Shield', 'Sword'],
        glow: { Sword: 0.3 },
        scale: 1.06,
      },
      3: {
        props: ['Knight_Helmet', 'Pauldron_L', 'Pauldron_R', 'Tower_Shield', 'Sword'],
        glow: { Sword: 1.2, Tower_Shield: 0.35 },
        scale: 1.14,
        metal: 'dark',
        aura: { color: '#A65BFF', core: '#E6CCFF', count: 22 },
      },
    },
  },
};

/** Clip used for each logical action (walk jumps, the others run). */
export const MOVE_CLIP: Record<CharacterId, ClipName> = { sad: 'run', marki: 'run', walk: 'jump' };
