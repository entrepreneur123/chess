/**
 * Per-character / per-level look of the glTF units (public/models/{sad,marki,walk}.glb, built by
 * docs/brand/models/build.mjs). Pure data:
 *  - `roles` classify the source palette (atlas cell for the KayKit humanoids, material slot for
 *    the bull) into semantic roles (armor, leather, team cloth, ...);
 *  - every level remaps those roles to its own palette (colour + metal + glow + pattern), so
 *    Lv1 / Lv2 / Lv3 differ in colour first, then in gear (outfits.ts) and FX (fx.ts);
 *  - scale, shown glTF props and idle FX per level.
 * Team accents ('team*' colours) are resolved per owner at build time.
 */
import type { CharacterId, Level } from '../../engine/types';

/** Logical animation clip names (renamed in the asset pipeline). */
export type ClipName = 'idle' | 'run' | 'jump' | 'attack' | 'death';

/** A colour: sRGB hex or a team accent resolved per owner. */
export type Tint = string | 'team' | 'teamLight' | 'teamDark' | 'teamMuted' | 'teamDeep';

export interface RoleStyle {
  color: Tint;
  /** Keep the source palette's shading gradient (default true). */
  shade?: boolean;
  glow?: number;
  metal?: number;
  /** material.ts PATTERN id. */
  pattern?: number;
}

/** Idle particles (GPU animated points around the unit). */
export interface ParticleLook {
  count: number;
  /** Point size in world units. */
  size: number;
  color: string;
  core: string;
  /** Orbit radius and rise height (tile units). */
  radius: number;
  height: number;
  /** Rise speed (cycles per second). */
  speed: number;
}

export interface LevelLook {
  /** Rigid glTF prop nodes shown at this level (skinned body parts are always shown). */
  props: string[];
  /** Per-prop scale (around its bone attachment). */
  propScale?: Record<string, number>;
  /** Whole-unit scale multiplier (on top of the per-character fitted size). */
  scale: number;
  /** Role -> style. Roles missing here keep their source colour. */
  palette: Record<string, RoleStyle>;
  /** Emissive accent used by glowing trim (and the glow tint of the pulse). */
  glow: string;
  /** Pattern colour (lava cracks / runes / flames). */
  patternColor?: string;
  particles?: ParticleLook;
  /** Lv3: rotating ground rune + aura (rune colour, aura colour). */
  rune?: { color: string; aura: string };
  /** Lv3: vertical light shaft. */
  shaft?: { color: string; opacity: number };
  /** Idle clip speed (Lv3 "power" idle is slower and heavier). */
  idleSpeed?: number;
  /** Lv3 hover/breathe bob amplitude (tile units). */
  bob?: number;
}

export interface CharacterLook {
  file: string;
  /** World height (feet to head top) of the Lv1 unit on the board, in tile units. */
  height: number;
  /** For long quadrupeds: cap on the model length along its facing axis (tile units). */
  maxLength?: number;
  /** Atlas grid (humanoids): columns x rows of palette cells. */
  grid?: [number, number];
  /** Source palette classification: atlas cell "col,row" (or bull material slot name) -> role. */
  roles: Record<string, string>;
  /** Normalized time (0..1) of the attack clip's impact frame. */
  impact: number;
  /** Team rim-light strength (fresnel). */
  rim: number;
  /** Non-uniform model scale (x = width) applied on top of the fitted scale. */
  stretch?: [number, number, number];
  /** Rest-pose bone scales (sanitized glTF bone names) to stylise proportions. */
  boneScale?: Record<string, number>;
  /** Extra local rotation (radians about world x at rest) folded into every clip for a bone. */
  bonePitch?: Record<string, number>;
  /** Smooth the authored (faceted) normals of the body. */
  smooth?: boolean;
  levels: Record<Level, LevelLook>;
}

/** Atlas roles of the KayKit knight palette (8 x 4 cells). */
const KNIGHT_ROLES: Record<string, string> = {
  '0,0': 'skin', '1,0': 'hair', '2,0': 'eye', '3,0': 'armor', '4,0': 'dark', '5,0': 'leather', '6,0': 'leather', '7,0': 'armor2',
  '0,1': 'team', '1,1': 'white', '2,1': 'armor2', '3,1': 'steel', '4,1': 'gold', '5,1': 'grip', '6,1': 'trim', '7,1': 'dark',
  '0,2': 'white', '1,2': 'trim', '2,2': 'gem', '3,2': 'leather', '4,2': 'trim', '5,2': 'trim', '6,2': 'dark', '7,2': 'dark',
};

/** Barbarian palette (left 8 cells) + knight props (right 8 cells) of the merged walk atlas. */
const WALK_ROLES: Record<string, string> = {
  '0,0': 'skin', '1,0': 'hair', '2,0': 'eye', '3,0': 'steel', '4,0': 'dark', '5,0': 'leather', '6,0': 'leather', '7,0': 'fur',
  '0,1': 'team', '1,1': 'team', '2,1': 'cloth', '3,1': 'steel', '4,1': 'wood', '5,1': 'leather', '6,1': 'fur', '7,1': 'pants',
  '0,2': 'cloth', '1,2': 'gold', '2,2': 'team', '3,2': 'pants', '4,2': 'wood', '5,2': 'wood', '6,2': 'dark', '7,2': 'wraps',
};
for (const [k, v] of Object.entries(KNIGHT_ROLES)) {
  const [c, r] = k.split(',').map(Number);
  WALK_ROLES[`${c + 8},${r}`] = v === 'armor' || v === 'armor2' ? 'steel' : v === 'white' ? 'cloth' : v === 'grip' ? 'leather' : v === 'gem' ? 'team' : v;
}

/** Rogue palette (8 x 4): skin / hair / eyes / steel / leathers / green tunic + cape / boots. */
const ROGUE_ROLES: Record<string, string> = {
  '0,0': 'skin', '1,0': 'hair', '2,0': 'eye', '3,0': 'steel', '4,0': 'dark', '5,0': 'leather', '6,0': 'leather2', '7,0': 'dark',
  '0,1': 'cloth', '1,1': 'cloth2', '2,1': 'steel', '3,1': 'steel', '4,1': 'dark', '5,1': 'leather', '6,1': 'leather2', '7,1': 'pants',
  '0,2': 'white', '1,2': 'cloth2', '2,2': 'cloth2', '3,2': 'boots', '4,2': 'leather', '5,2': 'wraps', '6,2': 'dark', '7,2': 'dark',
};

export const LOOKS: Record<CharacterId, CharacterLook> = {
  // Paladin (KayKit Knight). Lv1 dull field steel -> Lv2 silver-blue + gold trim -> Lv3 holy white/gold.
  sad: {
    file: 'models/sad.glb',
    height: 1.72,
    rim: 0.45,
    grid: [8, 4],
    roles: KNIGHT_ROLES,
    impact: 0.42,
    boneScale: { head: 0.84, chest: 1.06 },
    levels: {
      1: {
        props: ['Knight_Helmet', '1H_Sword'],
        scale: 1,
        glow: '#FFFFFF',
        palette: {
          armor: { color: '#86827A', metal: 0.25 },
          armor2: { color: '#66625C', metal: 0.2 },
          steel: { color: '#9A988F', metal: 0.4 },
          dark: { color: '#3A3631' },
          leather: { color: '#6A4A33' },
          grip: { color: '#4E3524' },
          trim: { color: '#7C6C58' },
          gold: { color: '#8E7A52', metal: 0.3 },
          team: { color: 'teamMuted' },
          gem: { color: 'teamMuted' },
          white: { color: '#B5AE9E' },
        },
      },
      2: {
        props: ['Knight_Helmet', '2H_Sword', 'Pauldron_L', 'Pauldron_R'],
        scale: 1.06,
        glow: '#9FD8FF',
        patternColor: '#7FD0FF',
        palette: {
          armor: { color: '#AFC6EE', metal: 0.9 },
          armor2: { color: '#3D5FA8', metal: 0.85 },
          steel: { color: '#DDEBFF', metal: 0.95 },
          dark: { color: '#1F2A44' },
          leather: { color: '#2B3550' },
          grip: { color: '#232B40' },
          trim: { color: '#E8B64A', metal: 0.9, glow: 0.12 },
          gold: { color: '#F2C14E', metal: 0.9, glow: 0.2 },
          team: { color: 'team' },
          gem: { color: 'teamLight', glow: 0.8 },
          white: { color: '#EEF3FA' },
        },
        particles: { count: 9, size: 0.07, color: '#7FC8FF', core: '#FFFFFF', radius: 0.34, height: 1.25, speed: 0.32 },
      },
      3: {
        props: ['Knight_Helmet', 'Gold_Sword', 'Pauldron_L', 'Pauldron_R'],
        propScale: { Gold_Sword: 1.22 },
        scale: 1.15,
        glow: '#FFD45C',
        patternColor: '#FFE9A0',
        palette: {
          armor: { color: '#FFF8EA', metal: 0.55 },
          armor2: { color: '#F2B92E', metal: 1, glow: 0.18 },
          steel: { color: '#F5C842', metal: 1, glow: 0.2 },
          dark: { color: '#B9831F', metal: 0.8 },
          leather: { color: '#F3E7CF' },
          grip: { color: '#7A4A16' },
          trim: { color: '#FFD34D', metal: 1, glow: 0.35 },
          gold: { color: '#F2B41E', metal: 1, glow: 0.4 },
          team: { color: 'team', glow: 0.18 },
          gem: { color: 'teamLight', glow: 1.4 },
          white: { color: '#FFFFFF', glow: 0.1 },
        },
        particles: { count: 26, size: 0.11, color: '#FFC94A', core: '#FFF7D6', radius: 0.46, height: 1.9, speed: 0.42 },
        rune: { color: '#FFD45C', aura: '#FFB733' },
        shaft: { color: '#FFE6A0', opacity: 0.55 },
        idleSpeed: 0.8,
        bob: 0.035,
      },
    },
  },
  // Charging war bull (Quaternius). Lv1 brown beast -> Lv2 blood-red hide + iron -> Lv3 obsidian + lava.
  marki: {
    file: 'models/marki.glb',
    height: 1.22,
    maxLength: 1.9,
    rim: 0.3,
    stretch: [1.3, 1, 1],
    boneScale: {
      Head: 1.22,
      Neck1: 1.18,
      Neck2: 1.06,
      Torso: 1.1,
      Torso2: 1.14,
      Torso3: 1.12,
      FrontShoulderL: 1.16,
      FrontShoulderR: 1.16,
      BackShoulderL: 1.08,
      BackShoulderR: 1.08,
    },
    bonePitch: { Neck1: 0.3, Head: -0.12 },
    smooth: true,
    roles: {
      Main: 'hide',
      Main_Light: 'hide2',
      Hooves: 'hoof',
      Muzzle: 'muzzle',
      Eye_Black: 'pupil',
      Eye_White: 'eye',
      Horns: 'horn',
      plate: 'plate',
      plate_team: 'team',
    },
    impact: 0.45,
    levels: {
      1: {
        props: ['Saddle'],
        scale: 1,
        glow: '#FF9A3C',
        palette: {
          hide: { color: '#6B3E25' },
          hide2: { color: '#9A6A45' },
          muzzle: { color: '#3E2A22' },
          hoof: { color: '#2A221E' },
          horn: { color: '#DCCFB2' },
          eye: { color: '#FF8A2A', glow: 0.6 },
          pupil: { color: '#1A0A04' },
          plate: { color: '#6A5848', metal: 0.25 },
          team: { color: 'teamMuted' },
        },
      },
      2: {
        props: ['Plate_L', 'Plate_R', 'Saddle'],
        scale: 1.06,
        glow: '#FF7A2A',
        patternColor: '#FF7A2A',
        palette: {
          hide: { color: '#5A1A12' },
          hide2: { color: '#8A2E1E' },
          muzzle: { color: '#2A1210' },
          hoof: { color: '#4A505A', metal: 0.8 },
          horn: { color: '#D7CBB4' },
          eye: { color: '#FF4A1A', glow: 1.1 },
          pupil: { color: '#FFB060', glow: 0.8 },
          plate: { color: '#7A8492', metal: 0.85 },
          team: { color: 'team' },
        },
        particles: { count: 8, size: 0.075, color: '#FF7A2A', core: '#FFD9A0', radius: 0.5, height: 0.9, speed: 0.36 },
      },
      3: {
        props: ['Plate_L', 'Plate_R', 'Saddle_Spike'],
        scale: 1.15,
        glow: '#FF6A1F',
        patternColor: '#FF6A14',
        palette: {
          hide: { color: '#1A1416', pattern: 2 },
          hide2: { color: '#2E1E1A', pattern: 2 },
          muzzle: { color: '#120C0C' },
          hoof: { color: '#FF8A2A', glow: 1.0 },
          horn: { color: '#2A2226', metal: 0.6 },
          eye: { color: '#FFD040', glow: 2.0 },
          pupil: { color: '#FFF0A0', glow: 2.0 },
          plate: { color: '#2A2A30', metal: 0.9 },
          team: { color: 'team', glow: 0.25 },
        },
        particles: { count: 28, size: 0.11, color: '#FF5A14', core: '#FFD27A', radius: 0.55, height: 1.5, speed: 0.5 },
        rune: { color: '#FF6A1F', aura: '#FF3A0A' },
        shaft: { color: '#FF7A2A', opacity: 0.5 },
        idleSpeed: 0.75,
      },
    },
  },
  // Shield bearer (KayKit Barbarian + knight-atlas props). Lv1 leather -> Lv2 steel + chain -> Lv3 arcane.
  walk: {
    file: 'models/walk.glb',
    height: 1.68,
    rim: 0.45,
    grid: [16, 4],
    roles: WALK_ROLES,
    impact: 0.4,
    boneScale: { head: 0.86, chest: 1.08 },
    levels: {
      1: {
        props: ['Barbarian_Round_Shield'],
        scale: 1,
        glow: '#FFFFFF',
        palette: {
          skin: { color: '#E0A27E' },
          leather: { color: '#7A5034' },
          fur: { color: '#5E4A3A' },
          cloth: { color: '#A69882' },
          pants: { color: '#4E4034' },
          wraps: { color: '#8C7458' },
          steel: { color: '#868B92', metal: 0.3 },
          wood: { color: '#8A6440' },
          gold: { color: '#8E7A52' },
          team: { color: 'teamMuted' },
          dark: { color: '#33302C' },
        },
      },
      2: {
        props: ['Kite_Shield', 'Pauldron_L', 'Pauldron_R'],
        scale: 1.06,
        glow: '#BFE3FF',
        patternColor: '#8FD3FF',
        palette: {
          skin: { color: '#E0A27E' },
          leather: { color: '#98A3B2', metal: 0.75, pattern: 1 },
          fur: { color: '#3E4552' },
          cloth: { color: '#D8DEE8' },
          pants: { color: '#2C3442' },
          wraps: { color: '#5C6878' },
          steel: { color: '#CBD5E2', metal: 0.9 },
          wood: { color: '#3A3F4A', metal: 0.4 },
          gold: { color: '#E8B64A', metal: 0.9, glow: 0.15 },
          team: { color: 'team' },
          dark: { color: '#20252E' },
        },
        particles: { count: 8, size: 0.065, color: '#BFE3FF', core: '#FFFFFF', radius: 0.36, height: 1.2, speed: 0.3 },
      },
      3: {
        props: ['Tower_Shield', 'Pauldron_L', 'Pauldron_R'],
        propScale: { Tower_Shield: 1.18 },
        scale: 1.14,
        glow: '#B57BFF',
        patternColor: '#C08CFF',
        palette: {
          skin: { color: '#C99A86' },
          leather: { color: '#3A2A5E', metal: 0.7, pattern: 1 },
          fur: { color: '#1C1430' },
          cloth: { color: '#9C7CFF', glow: 0.35 },
          pants: { color: '#1A1428' },
          wraps: { color: '#4A3478' },
          steel: { color: '#4C3E7C', metal: 0.95 },
          wood: { color: '#2A2040', metal: 0.5 },
          gold: { color: '#E0C36A', metal: 1, glow: 0.3 },
          team: { color: 'team', glow: 0.25 },
          dark: { color: '#120E1C' },
        },
        particles: { count: 26, size: 0.11, color: '#A65BFF', core: '#F0DDFF', radius: 0.46, height: 1.8, speed: 0.4 },
        rune: { color: '#B57BFF', aura: '#7A3CFF' },
        shaft: { color: '#C9A0FF', opacity: 0.55 },
        idleSpeed: 0.8,
        bob: 0,
      },
    },
  },
  // Imp (KayKit Rogue). Legendary prankster devil: Lv1 crimson skin + rag loincloth + crooked trident ->
  // Lv2 bone mask, jester coat, twin violet daggers -> Lv3 horn crown, flame cape, rune-cracked skin, orbit shards.
  insaner: {
    file: 'models/insaner.glb',
    height: 1.42,
    rim: 0.55,
    grid: [8, 4],
    roles: ROGUE_ROLES,
    impact: 0.38,
    boneScale: { head: 1.16, chest: 0.96, handl: 1.18, handr: 1.18 },
    levels: {
      1: {
        props: [],
        scale: 1,
        glow: '#9CFF3A',
        patternColor: '#B6FF4A',
        palette: {
          skin: { color: '#8E1E3A' },
          hair: { color: '#2A1030' },
          eye: { color: '#9CFF3A', glow: 2.2, shade: false },
          steel: { color: '#3A2A3E', metal: 0.5 },
          dark: { color: '#1C1020' },
          leather: { color: '#3C2230' },
          leather2: { color: '#2A1622' },
          cloth: { color: '#8E1E3A' },
          cloth2: { color: 'teamMuted' },
          white: { color: '#D9C9A8' },
          pants: { color: '#5A1A44' },
          boots: { color: '#4A1636' },
          wraps: { color: 'teamMuted' },
        },
        particles: { count: 6, size: 0.06, color: '#9CFF3A', core: '#F2FFD0', radius: 0.3, height: 1.0, speed: 0.4 },
        idleSpeed: 1.15,
      },
      2: {
        props: ['Knife', 'Knife_Offhand'],
        propScale: { Knife: 1.15, Knife_Offhand: 1.15 },
        scale: 1.06,
        glow: '#C85CFF',
        patternColor: '#D27CFF',
        palette: {
          skin: { color: '#7A1238' },
          hair: { color: '#160A1E' },
          eye: { color: '#9CFF3A', glow: 2.4, shade: false },
          steel: { color: '#1A1020', metal: 0.85 },
          dark: { color: '#120A16' },
          leather: { color: '#2E1430' },
          leather2: { color: '#1E0E22' },
          cloth: { color: '#3A1452', pattern: 1 },
          cloth2: { color: 'team' },
          white: { color: '#EFE4C8' },
          pants: { color: '#2A0E36' },
          boots: { color: '#1A0E20', metal: 0.3 },
          wraps: { color: 'team' },
        },
        particles: { count: 12, size: 0.07, color: '#C85CFF', core: '#F6E6FF', radius: 0.36, height: 1.3, speed: 0.45 },
        idleSpeed: 1.25,
      },
      3: {
        props: ['Knife', 'Knife_Offhand'],
        propScale: { Knife: 1.3, Knife_Offhand: 1.3 },
        scale: 1.15,
        glow: '#FF3DF0',
        patternColor: '#FF4AF2',
        palette: {
          skin: { color: '#4A0C2E', pattern: 2 },
          hair: { color: '#0C0612' },
          eye: { color: '#B6FF3A', glow: 3.0, shade: false },
          steel: { color: '#0E0A14', metal: 0.95 },
          dark: { color: '#0A0610' },
          leather: { color: '#2A0E34' },
          leather2: { color: '#160A1E' },
          cloth: { color: '#2A0C3E', pattern: 2 },
          cloth2: { color: 'team', glow: 0.3 },
          white: { color: '#FFF0E0', glow: 0.2 },
          pants: { color: '#1C0A2A', pattern: 2 },
          boots: { color: '#0E0612', metal: 0.5 },
          wraps: { color: 'team', glow: 0.25 },
        },
        particles: { count: 32, size: 0.12, color: '#FF3DF0', core: '#FFE0FB', radius: 0.5, height: 1.9, speed: 0.55 },
        rune: { color: '#FF3DF0', aura: '#9A1BFF' },
        shaft: { color: '#FF7AF5', opacity: 0.6 },
        idleSpeed: 1.45,
        bob: 0.03,
      },
    },
  },
};

/** Clip used for each logical action (walk jumps, the others run). */
export const MOVE_CLIP: Record<CharacterId, ClipName> = { sad: 'run', marki: 'run', walk: 'jump', insaner: 'run' };
