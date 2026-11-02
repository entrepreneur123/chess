/**
 * Outfit construction context handed to the per-character builders (outfits/*.ts) plus small shared
 * helpers. Coordinates: "rest world" = the character's rest T-pose (facing +z, y up, metres) AFTER
 * its bone scales; body sources and shells live in the unscaled bind space (they are skinned with
 * the body's own weights, so bone scales apply to them automatically).
 */
import * as THREE from 'three';
import type { CharacterId, Level } from '../../engine/types';
import type { BodySource, ShellSpec, SrcMesh, VInfo } from './body';
import type { LevelLook } from './config';
import type { GearBuilder, SkinFn } from './gear';
import type { Style } from './style';

/** Secondary-motion bone driven by the actor (cloth, wings, pennant, tail). */
export interface SecondarySpec {
  bone: string;
  /** Rotation axis in the bone's local frame (= rest world frame). */
  axis: [number, number, number];
  idleAmp: number;
  idleFreq: number;
  /** Extra angle while running / jumping. */
  run: number;
  phase: number;
  /** Continuous rotation (rad/s) on top of the sway (orbiting FX). */
  spin?: number;
  /** 0..1: how much the bone keeps its rest WORLD orientation (cloth hangs down when the body leans). */
  hang?: number;
}

export interface OutfitCtx {
  ch: CharacterId;
  level: Level;
  look: LevelLook;
  src: BodySource;
  gear: GearBuilder;
  secondary: SecondarySpec[];
  /** Index of a bone in the unit skeleton. */
  bone(name: string): number;
  /** Rest world position of a bone (after bone scales). */
  at(name: string): THREE.Vector3;
  /** Rest world matrix of a bone (after bone scales). */
  boneWorld(name: string): THREE.Matrix4;
  /** New bone under `parent` at a rest world position (identity rest world rotation). */
  addBone(name: string, parent: string, at: THREE.Vector3): number;
  /** Include a source mesh in the unit (all its non-hidden triangles) with a per-vertex style. */
  use(mesh: string, style: (i: number) => Style): void;
  /** Drop triangles of a source mesh (covered by armour / replaced). */
  hide(mesh: string, tris: Uint8Array): void;
  /** Add an armour shell made from triangles of a source mesh. */
  shell(mesh: string, spec: ShellSpec, hide?: boolean): void;
  /** Vertex mask / triangle mask of a source mesh. */
  vmask(mesh: string, pred: (v: VInfo) => boolean): Uint8Array;
  tris(mesh: string, pred: (v: VInfo) => boolean, need?: number): Uint8Array;
  /** Rest world position (after bone scales) of a bind-space point skinned like vertex i of a mesh. */
  world(mesh: string, i: number, out?: THREE.Vector3): THREE.Vector3;
  srcMesh(mesh: string): SrcMesh;
  /**
   * Idle-pose -> rest-pose transform of a bone: maps a point / direction given in WORLD space of the
   * idle pose (unit facing +z) to rest world, so gear rigid to the bone sits as wanted while idling.
   */
  idleToRest(bone: string): THREE.Matrix4;
  /** Body texture colour (sRGB 0..1) at a UV, or null if the texture cannot be read. */
  texel(u: number, v: number): [number, number, number] | null;
  /** Rigid skin to a bone, or a blend of two bones along an axis. */
  rigid(name: string): number;
  blend(a: string, b: string, from: THREE.Vector3, to: THREE.Vector3): SkinFn;
}

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Cheap deterministic value noise (dents, ragged edges). */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Bone name sets used by region predicates. */
export const RE = {
  head: /^Head$/,
  neck: /^neck_01$/,
  spine: /^spine_0[123]$/,
  chest: /^spine_0[23]$/,
  clav: /^clavicle_[lr]$/,
  pelvis: /^pelvis$/,
  upperarm: /^upperarm_[lr]$/,
  lowerarm: /^lowerarm_[lr]$/,
  hand: /^(hand|index|middle|ring|pinky|thumb)_/,
  thigh: /^thigh_[lr]$/,
  calf: /^calf_[lr]$/,
  foot: /^(foot|ball)_[lr]$/,
};

export const is = (bone: string, ...res: RegExp[]): boolean => res.some((r) => r.test(bone));
