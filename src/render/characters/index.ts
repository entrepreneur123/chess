/**
 * Procedural low-poly 3D characters for GRID CLASH (no model files).
 *
 *   const g = buildCharacterModel({ character: 'sad', level: 2, owner: 0 });
 *   scene.add(g);
 *
 * - Feet at y = 0, model faces +z (rotate by Math.PI around y for player 1).
 * - Geometries/materials are shared through an internal cache: DO NOT dispose them per instance,
 *   call disposeCharacterCache() once when the whole scene is torn down.
 * - Child 'head' (Object3D) marks the head centre; userData.anchor is a Vector3 just above the
 *   model (level-up bursts, floating labels, ...).
 */
import * as THREE from 'three';
import type { CharacterId, Level, PlayerId } from '../../engine/types';
import { CHARACTER_RARITY, RARITY_COLORS } from '../palette';
import { TEAM, disposeKit, groundRing, std, type BuildCtx } from './kit';
import { buildMarki } from './marki';
import { buildSad } from './sad';
import { buildInsaner } from './insaner';
import { buildWalk } from './walk';

/** Characters listed explicitly; Rakaeli is added through a cast (see palette.ts). */
type CoreCharacterId = Exclude<CharacterId, 'rakaeli'>;
type Builder = (g: THREE.Group, ctx: BuildCtx) => void;

export interface CharacterModelOptions {
  character: CharacterId;
  level: Level;
  owner: PlayerId;
}

/** Approximate model height (feet to top of plume / horns / spear-less silhouette) in world units. */
export const CHARACTER_MODEL_HEIGHT = {
  rakaeli: 1.0,
  sad: 1.0,
  marki: 0.75,
  walk: 1.0,
  insaner: 1.0,
  brutile: 1.0,
  michelle: 0.9,
  picker: 1.0,
  rampid: 0.9,
  larhen: 1.0,
  volkonov: 1.0,
  verish: 0.95,
  midos: 1.0,
  hammont: 1.0,
  venoa: 1.0,
  glacia: 1.0,
} satisfies Record<CoreCharacterId, number> & { rakaeli: number } as Record<CharacterId, number>;

/** Uniform scale applied to each builder's output so that all units read at a similar size. */
const BODY_SCALE = {
  rakaeli: 0.9,
  sad: 0.9,
  marki: 0.95,
  walk: 0.94,
  insaner: 0.92,
  brutile: 0.92,
  michelle: 0.86,
  picker: 0.92,
  rampid: 0.88,
  larhen: 0.92,
  volkonov: 0.92,
  verish: 0.9,
  midos: 0.92,
  hammont: 0.95,
  venoa: 0.9,
  glacia: 0.9,
} satisfies Record<CoreCharacterId, number> & { rakaeli: number } as Record<CharacterId, number>;

/** Head-centre height per character (used by the 'head' marker). */
const HEAD_POS = {
  rakaeli: [0, 0.79, 0],
  sad: [0, 0.79, 0],
  marki: [0, 0.42, 0.45],
  walk: [0, 0.77, 0],
  insaner: [0, 0.84, 0],
  brutile: [0, 0.84, 0],
  michelle: [0, 0.8, 0],
  picker: [0, 0.79, 0],
  rampid: [0, 0.79, 0],
  larhen: [0, 0.79, 0],
  volkonov: [0, 0.79, 0],
  verish: [0, 0.79, 0],
  midos: [0, 0.79, 0],
  hammont: [0, 0.79, 0],
  venoa: [0, 0.79, 0],
  glacia: [0, 0.79, 0],
} satisfies Record<CoreCharacterId, [number, number, number]> & { rakaeli: [number, number, number] } as Record<CharacterId, [number, number, number]>;

const BUILDERS = {
  // Placeholder (top-down tokens only): the paladin silhouette until Rakaeli gets his own model.
  rakaeli: buildSad,
  sad: buildSad,
  marki: buildMarki,
  walk: buildWalk,
  insaner: buildInsaner,
  // Placeholder (3D arena disabled): Brutile reuses the imp build until she gets her own model.
  brutile: buildInsaner,
  // Placeholders as well (top-down tokens only): the closest existing silhouettes.
  michelle: buildInsaner,
  picker: buildSad,
  rampid: buildSad,
  larhen: buildSad,
  volkonov: buildSad,
  verish: buildSad,
  midos: buildSad,
  hammont: buildSad,
  venoa: buildSad,
  glacia: buildSad,
} satisfies Record<CoreCharacterId, Builder> & { rakaeli: Builder } as Record<CharacterId, Builder>;

/** Builds a THREE.Group ~1.0 unit tall (feet at y=0, facing +z). See file header for conventions. */
export function buildCharacterModel(opts: CharacterModelOptions): THREE.Group {
  const { character, level, owner } = opts;
  const g = new THREE.Group();
  g.name = `char-${character}-lv${level}-p${owner}`;
  const body = new THREE.Group();
  body.name = 'body';
  g.add(body);
  BUILDERS[character](body, { level, owner, team: TEAM[owner] });
  body.scale.setScalar(BODY_SCALE[character]);

  // Thin rarity ring on the ground (the only place the rarity colour is used).
  const ringColor = RARITY_COLORS[CHARACTER_RARITY[character]];
  const ring = groundRing(
    g,
    0.4,
    0.018,
    std(ringColor, { metalness: 0.1, roughness: 0.5, emissive: ringColor, emissiveIntensity: 0.6, flat: false }),
    0.012,
  );
  ring.name = 'rarity-ring';

  const head = new THREE.Object3D();
  head.name = 'head';
  head.position.set(...HEAD_POS[character]).multiplyScalar(BODY_SCALE[character]);
  g.add(head);
  g.userData.anchor = new THREE.Vector3(0, CHARACTER_MODEL_HEIGHT[character] + (level === 3 ? 0.12 : 0.06), 0);
  g.userData.character = character;
  g.userData.level = level;
  return g;
}

/** Dispose all cached geometries/materials. */
export function disposeCharacterCache(): void {
  disposeKit();
}

export { buildBatchedCharacterModel, createBatchMaterials, disposeBatchMaterials } from './batch';
export type { BatchMaterials } from './batch';
