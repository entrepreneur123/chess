/**
 * Per-character / per-level look of the glTF units (bodies public/models/{hero,imp}.glb, clips
 * public/models/anims.glb, built by docs/brand/models/build.mjs). Pure data: which body, board size,
 * animation clips (source clip names + trims), proportion tweaks (bone scales) and the per-level
 * scale / glow / FX. The armour, weapons and colours of each level are built in outfits/*.ts.
 */
import type { CharacterId, Level } from '../../engine/types';

/** Logical animation clip names. */
export type ClipName = 'idle' | 'run' | 'jump' | 'attack' | 'death' | 'hit';

/** A clip from anims.glb (seconds), optionally followed by another one (e.g. jump start + land). */
export interface ClipSpec {
  src: string;
  from?: number;
  to?: number;
  then?: ClipSpec;
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
  /** Whole-unit scale multiplier (on top of the per-character fitted size). */
  scale: number;
  /** Emissive accent used by glowing trim (and the glow tint of the pulse / capture flash). */
  glow: string;
  /** Pattern colour (lava cracks / runes / flames / filigree). */
  patternColor?: string;
  /** Emissive colour of the body texture's glow mask (imp eyes). */
  eye?: string;
  particles?: ParticleLook;
  /** Lv3: rotating ground rune + aura (rune colour, aura colour). */
  rune?: { color: string; aura: string };
  /** Lv3: vertical light shaft. */
  shaft?: { color: string; opacity: number };
  /** Idle clip speed. */
  idleSpeed?: number;
  /** Hover/breathe bob amplitude (tile units). */
  bob?: number;
}

export interface CharacterLook {
  body: 'hero' | 'imp';
  /** World height (feet to head top) of the bare Lv1 body on the board, in tile units. */
  height: number;
  /** Normalized time (0..1) of the attack clip's impact frame. */
  impact: number;
  /** Team rim-light strength (fresnel). */
  rim: number;
  clips: Partial<Record<ClipName, ClipSpec>>;
  /** Rest-pose bone scales (x, y, z in the bone's frame) to stylise proportions. */
  boneScale?: Record<string, [number, number, number]>;
  levels: Record<Level, LevelLook>;
}

const BASE_LOOKS: Record<Exclude<CharacterId, 'michelle' | 'picker'>, CharacterLook> = {
  // Holy paladin: Lv1 squire (dented steel over gambeson) -> Lv2 silver-blue knight with gold trim ->
  // Lv3 white-gold holy champion with a radiant greatsword.
  sad: {
    body: 'hero',
    height: 1.5,
    impact: 0.45,
    rim: 0.45,
    clips: {
      idle: { src: 'Idle_Shield_Loop' },
      run: { src: 'Jog_Fwd_Loop' },
      attack: { src: 'Sword_Regular_A' },
      hit: { src: 'Hit_Chest' },
      death: { src: 'Death01', to: 1.3 },
    },
    levels: {
      1: { scale: 1, glow: '#FFFFFF' },
      2: {
        scale: 1.05,
        glow: '#8FD4FF',
        patternColor: '#7FD0FF',
        particles: { count: 9, size: 0.07, color: '#7FC8FF', core: '#FFFFFF', radius: 0.34, height: 1.25, speed: 0.32 },
      },
      3: {
        scale: 1.12,
        glow: '#FFD45C',
        patternColor: '#FFE9A0',
        particles: { count: 26, size: 0.11, color: '#FFC94A', core: '#FFF7D6', radius: 0.46, height: 1.9, speed: 0.42 },
        rune: { color: '#FFD45C', aura: '#FFB733' },
        shaft: { color: '#FFE6A0', opacity: 0.55 },
        idleSpeed: 0.85,
        bob: 0.025,
      },
    },
  },
  // Minotaur bruiser: Lv1 brown hide + leather -> Lv2 blood-red hide + iron -> Lv3 obsidian hide with
  // molten cracks, flaming horns and mane.
  marki: {
    body: 'hero',
    height: 1.5,
    impact: 0.5,
    rim: 0.32,
    clips: {
      idle: { src: 'Idle_FoldArms_Loop' },
      run: { src: 'Sprint_Loop' },
      attack: { src: 'Punch_Cross' },
      hit: { src: 'Hit_Chest' },
      death: { src: 'Death01', to: 1.3 },
    },
    boneScale: {
      spine_02: [1.08, 1, 1.08],
      spine_03: [1.14, 1.04, 1.12],
      clavicle_l: [1.12, 1.12, 1.12],
      clavicle_r: [1.12, 1.12, 1.12],
      upperarm_l: [1, 1.12, 1.12],
      upperarm_r: [1, 1.12, 1.12],
      neck_01: [1.3, 0.9, 1.3],
      thigh_l: [1, 1.1, 1.1],
      thigh_r: [1, 1.1, 1.1],
    },
    levels: {
      1: { scale: 1, glow: '#FF9A3C' },
      2: {
        scale: 1.05,
        glow: '#FF7A2A',
        patternColor: '#FF7A2A',
        particles: { count: 10, size: 0.075, color: '#FF7A2A', core: '#FFD9A0', radius: 0.42, height: 1.2, speed: 0.36 },
      },
      3: {
        scale: 1.1,
        glow: '#FF6A1F',
        patternColor: '#FF7A1E',
        particles: { count: 28, size: 0.11, color: '#FF5A14', core: '#FFD27A', radius: 0.5, height: 1.8, speed: 0.5 },
        rune: { color: '#FF6A1F', aura: '#FF3A0A' },
        shaft: { color: '#FF7A2A', opacity: 0.5 },
        idleSpeed: 0.85,
      },
    },
  },
  // Shield soldier / jumper: Lv1 militia -> Lv2 veteran in steel + mail -> Lv3 arcane guardian.
  walk: {
    body: 'hero',
    height: 1.48,
    impact: 0.4,
    rim: 0.45,
    clips: {
      idle: { src: 'Idle_Shield_Loop' },
      run: { src: 'Jog_Fwd_Loop' },
      jump: { src: 'NinjaJump_Start', from: 0.05, then: { src: 'NinjaJump_Land', from: 0.05, to: 0.95 } },
      attack: { src: 'Shield_OneShot' },
      hit: { src: 'Hit_Chest' },
      death: { src: 'Death01', to: 1.3 },
    },
    levels: {
      1: { scale: 1, glow: '#FFFFFF' },
      2: {
        scale: 1.05,
        glow: '#BFE3FF',
        patternColor: '#8FD3FF',
        particles: { count: 8, size: 0.065, color: '#BFE3FF', core: '#FFFFFF', radius: 0.36, height: 1.2, speed: 0.3 },
      },
      3: {
        scale: 1.12,
        glow: '#B57BFF',
        patternColor: '#C08CFF',
        particles: { count: 26, size: 0.11, color: '#A65BFF', core: '#F0DDFF', radius: 0.46, height: 1.8, speed: 0.4 },
        rune: { color: '#B57BFF', aura: '#7A3CFF' },
        shaft: { color: '#C9A0FF', opacity: 0.55 },
        idleSpeed: 0.85,
      },
    },
  },
  // Legendary prankster devil (imp): Lv1 red imp with a crooked trident -> Lv2 skull mask, jester coat,
  // twin violet daggers -> Lv3 mad king: horn crown, flame cape, magenta rune cracks, orbiting weapons.
  insaner: {
    body: 'imp',
    height: 1.45,
    impact: 0.42,
    rim: 0.55,
    clips: {
      idle: { src: 'Idle_Loop' },
      run: { src: 'Sprint_Loop' },
      attack: { src: 'Melee_Hook' },
      hit: { src: 'Hit_Chest' },
      death: { src: 'Death01', to: 1.3 },
    },
    levels: {
      1: {
        scale: 1,
        glow: '#9CFF3A',
        patternColor: '#B6FF4A',
        eye: '#B6FF3A',
        particles: { count: 6, size: 0.06, color: '#9CFF3A', core: '#F2FFD0', radius: 0.3, height: 1.0, speed: 0.4 },
        idleSpeed: 1.25,
      },
      2: {
        scale: 1.05,
        glow: '#C85CFF',
        patternColor: '#D27CFF',
        eye: '#B6FF3A',
        particles: { count: 12, size: 0.07, color: '#C85CFF', core: '#F6E6FF', radius: 0.36, height: 1.3, speed: 0.45 },
        idleSpeed: 1.35,
      },
      3: {
        scale: 1.15,
        glow: '#FF3DF0',
        patternColor: '#D22AD8',
        eye: '#D4FF4A',
        particles: { count: 32, size: 0.12, color: '#FF3DF0', core: '#FFE0FB', radius: 0.5, height: 1.9, speed: 0.55 },
        rune: { color: '#FF3DF0', aura: '#9A1BFF' },
        shaft: { color: '#FF7AF5', opacity: 0.6 },
        idleSpeed: 1.5,
        bob: 0.03,
      },
    },
  },
  // Legendary witch (placeholder for the disabled 3D arena: the imp body + devil outfit in toxic green;
  // the board is top-down only for now, where Brutile is her illustrated token).
  brutile: {
    body: 'imp',
    height: 1.45,
    impact: 0.42,
    rim: 0.55,
    clips: {
      idle: { src: 'Idle_Loop' },
      run: { src: 'Jog_Fwd_Loop' },
      attack: { src: 'Melee_Hook' },
      hit: { src: 'Hit_Chest' },
      death: { src: 'Death01', to: 1.3 },
    },
    levels: {
      1: {
        scale: 1,
        glow: '#6BFF3A',
        patternColor: '#6BFF3A',
        eye: '#9CFF3A',
        particles: { count: 6, size: 0.06, color: '#6BFF3A', core: '#E8FFC2', radius: 0.3, height: 1.0, speed: 0.35 },
      },
      2: {
        scale: 1.05,
        glow: '#6BFF3A',
        patternColor: '#4CE02A',
        eye: '#B6FF3A',
        particles: { count: 12, size: 0.07, color: '#6BFF3A', core: '#E8FFC2', radius: 0.36, height: 1.3, speed: 0.4 },
      },
      3: {
        scale: 1.12,
        glow: '#6BFF3A',
        patternColor: '#3BFF6A',
        eye: '#D4FF4A',
        particles: { count: 28, size: 0.11, color: '#6BFF3A', core: '#E8FFC2', radius: 0.48, height: 1.8, speed: 0.45 },
        rune: { color: '#6BFF3A', aura: '#5B1F86' },
        shaft: { color: '#8CFF6A', opacity: 0.5 },
        idleSpeed: 0.9,
      },
    },
  },
};

/**
 * Every character's look. Michelle and Picker have no glTF looks of their own yet (the 3D arena is
 * shelved; the top-down board only draws illustrated tokens), so they borrow the closest builds.
 */
export const LOOKS: Record<CharacterId, CharacterLook> = { ...BASE_LOOKS, michelle: BASE_LOOKS.brutile, picker: BASE_LOOKS.sad };

/** Clip used for each logical action (walk and picker jump, the others run). */
export const MOVE_CLIP: Record<CharacterId, ClipName> = { sad: 'run', marki: 'run', walk: 'jump', insaner: 'run', brutile: 'run', michelle: 'run', picker: 'jump' };

/**
 * Board fit constants for the camera / picking code (tile units, measured from the unit's feet =
 * the puck top, idle pose, Lv3 scale and bob included; see docs in the report):
 *  UNIT_MAX_HEIGHT  tallest unit incl. helmet plume / horns / flames / raised spear or greatsword
 *                   (walk Lv3 glaive 1.92, marki Lv3 burning horns 1.90, sad Lv3 1.70 + bob);
 *  UNIT_PICK_RADIUS horizontal half-width of a unit incl. weapons / shield / cape in idle
 *                   (Lv1-2 <= 0.40, Lv3 up to 0.46 with the rune disc underneath).
 */
export const UNIT_MAX_HEIGHT = 1.95;
export const UNIT_PICK_RADIUS = 0.4;
