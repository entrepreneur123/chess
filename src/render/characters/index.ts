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
import { buildWalk } from './walk';

export interface CharacterModelOptions {
  character: CharacterId;
  level: Level;
  owner: PlayerId;
}

/** Approximate model height (feet to top of plume / horns / spear-less silhouette) in world units. */
export const CHARACTER_MODEL_HEIGHT: Record<CharacterId, number> = {
  sad: 1.0,
  marki: 0.75,
  walk: 1.0,
};

/** Uniform scale applied to each builder's output so that all units read at a similar size. */
const BODY_SCALE: Record<CharacterId, number> = {
  sad: 0.9,
  marki: 0.95,
  walk: 0.94,
};

/** Head-centre height per character (used by the 'head' marker). */
const HEAD_POS: Record<CharacterId, [number, number, number]> = {
  sad: [0, 0.79, 0],
  marki: [0, 0.42, 0.45],
  walk: [0, 0.77, 0],
};

const BUILDERS: Record<CharacterId, (g: THREE.Group, ctx: BuildCtx) => void> = {
  sad: buildSad,
  marki: buildMarki,
  walk: buildWalk,
};

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
