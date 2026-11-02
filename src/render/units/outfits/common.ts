/**
 * Shared outfit pieces: body regions, armour shells, hand grips and weapons / shields / capes /
 * plumes / horns. Everything is authored in the rest T-pose (facing +z) and skinned rigidly to a
 * bone (weapons, shields, helmets) or blended (cloth). See kit.ts for the coordinate conventions.
 */
import * as THREE from 'three';
import type { ShellSpec, VInfo } from '../body';
import { alongY, blade, flat, plate, sheet, starOutline, taperTube, type SkinFn } from '../gear';
import { RE, V, clamp01, is, lerp, smooth, type OutfitCtx } from '../kit';
import { PATTERN } from '../material';
import type { Style, Tint } from '../style';

export type Side = 'l' | 'r';
export const SX: Record<Side, number> = { l: 1, r: -1 };

// ---------------------------------------------------------------- regions

/** Bounds (bind space) of the vertices of a mesh accepted by a predicate. */
export function boxOf(ctx: OutfitCtx, mesh: string, pred: (v: VInfo) => boolean): THREE.Box3 {
  const m = ctx.srcMesh(mesh);
  const mask = ctx.vmask(mesh, pred);
  const b = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < mask.length; i++) if (mask[i]) b.expandByPoint(p.fromArray(m.pos, i * 3));
  return b;
}

/** Landmarks of the human body (bind space, metres). */
export interface Anatomy {
  head: THREE.Box3;
  headC: THREE.Vector3;
  /** Brow line height (top of the eye sockets). */
  brow: number;
  neck: THREE.Box3;
  chest: THREE.Box3;
  pelvis: THREE.Box3;
  waist: number;
  knee: number;
}

export function anatomy(ctx: OutfitCtx): Anatomy {
  const head = boxOf(ctx, 'Body', (v) => v.bone === 'Head');
  const neck = boxOf(ctx, 'Body', (v) => v.bone === 'neck_01');
  const chest = boxOf(ctx, 'Body', (v) => is(v.bone, RE.spine, RE.clav));
  const pelvis = boxOf(ctx, 'Body', (v) => v.bone === 'pelvis');
  const hs = head.getSize(new THREE.Vector3());
  return {
    head,
    headC: head.getCenter(new THREE.Vector3()),
    brow: head.min.y + hs.y * 0.56,
    neck,
    chest,
    pelvis,
    waist: ctx.src.bonePos('spine_01').y,
    knee: ctx.src.bonePos('calf_l').y,
  };
}

/** Shell shorthand: region predicate -> armour (hides the covered body). */
export function armor(
  ctx: OutfitCtx,
  pred: (v: VInfo) => boolean,
  spec: Omit<ShellSpec, 'tris'> & { need?: number; mesh?: string; keep?: boolean },
): void {
  const mesh = spec.mesh ?? 'Body';
  ctx.shell(mesh, { ...spec, tris: ctx.tris(mesh, pred, spec.need ?? 3) }, !spec.keep);
}

/** Small deterministic dents for battered Lv1 plate. */
export function dents(amount: number): (p: THREE.Vector3) => number {
  return (p) => {
    const n = Math.sin(p.x * 61 + p.y * 37) * Math.sin(p.y * 53 - p.z * 41) * Math.sin(p.z * 47 + p.x * 29);
    return -amount * Math.max(0, n) * 1.8;
  };
}

/** Horizontal body cross-section (rest world, after bone scales) at height y. */
export function slice(ctx: OutfitCtx, y: number, band = 0.02, pred: (v: VInfo) => boolean = () => true): { cx: number; cz: number; rx: number; rz: number; front: number; back: number } {
  const b = new THREE.Box3();
  const w = new THREE.Vector3();
  const mask = ctx.vmask('Body', pred);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    ctx.world('Body', i, w);
    if (Math.abs(w.y - y) < band) b.expandByPoint(w);
  }
  if (b.isEmpty()) return { cx: 0, cz: 0, rx: 0.12, rz: 0.1, front: 0.1, back: -0.1 };
  return { cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, rx: (b.max.x - b.min.x) / 2, rz: (b.max.z - b.min.z) / 2, front: b.max.z, back: b.min.z };
}

/** Belt: elliptic band around the body at height y + a front buckle. */
export function belt(ctx: OutfitCtx, y: number, o: { style: Style; buckle: Style; out?: number; width?: number; bone?: string }): ReturnType<typeof slice> {
  const s = slice(ctx, y, 0.025, (v) => is(v.bone, RE.pelvis, RE.spine));
  const out = o.out ?? 0.02;
  const wdt = o.width ?? 0.045;
  const ring = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
  const bone = ctx.bone(o.bone ?? 'pelvis');
  ctx.gear.add(ring, new THREE.Matrix4().compose(V(s.cx, y, s.cz), new THREE.Quaternion(), V(s.rx + out, wdt, s.rz + out)), o.style, bone);
  ctx.gear.add(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true), new THREE.Matrix4().compose(V(s.cx, y, s.cz), new THREE.Quaternion(), V(s.rx + out - 0.006, wdt * 0.98, s.rz + out - 0.006)), o.style, bone);
  ctx.gear.add(flat(new THREE.BoxGeometry(0.07, wdt * 1.25, 0.025)), new THREE.Matrix4().makeTranslation(s.cx, y, s.cz + s.rz + out + 0.008), o.buckle, bone);
  return s;
}

// ---------------------------------------------------------------- hands

export interface Grip {
  /** Fist centre (rest world). */
  o: THREE.Vector3;
  /** Through the fist, thumb side (a held blade points this way). */
  axis: THREE.Vector3;
  /** Finger direction (wrist -> knuckles). */
  fingers: THREE.Vector3;
  /** Palm normal. */
  palm: THREE.Vector3;
  bone: number;
}

export function grip(ctx: OutfitCtx, side: Side): Grip {
  const hand = ctx.at(`hand_${side}`);
  const mid = ctx.at(`middle_01_${side}`);
  const idx = ctx.at(`index_01_${side}`);
  const pky = ctx.at(ctx.src.boneIndex.has(`pinky_01_${side}`) ? `pinky_01_${side}` : `ring_01_${side}`);
  const fingers = mid.clone().sub(hand).normalize();
  const axis = idx.clone().sub(pky);
  axis.addScaledVector(fingers, -axis.dot(fingers)).normalize();
  const palm = new THREE.Vector3().crossVectors(axis, fingers).normalize();
  if (palm.y > 0) palm.negate();
  const o = mid.clone().addScaledVector(fingers, 0.03).addScaledVector(palm, 0.035);
  return { o, axis, fingers, palm, bone: ctx.bone(`hand_${side}`) };
}

/** Matrix of a frame (x, y, z columns) at p. */
export function frame(p: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, s: number | [number, number, number] = 1): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
  if (typeof s === 'number') m.scale(V(s, s, s));
  else m.scale(V(s[0], s[1], s[2]));
  return m;
}

/** Orthonormal frame with `y` along a direction and `z` as close as possible to `zHint`. */
export function basisY(dir: THREE.Vector3, zHint: THREE.Vector3): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const y = dir.clone().normalize();
  const z = zHint.clone().addScaledVector(y, -zHint.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return [x, y, z];
}

// ---------------------------------------------------------------- weapons

export interface SwordLook {
  blade: number;
  width: number;
  steel: Style;
  guard: Style;
  grip: Style;
  pommel: Style;
  /** Glowing fuller / rune inlay. */
  rune?: Style;
  /** Wider, flared guard (holy greatsword). */
  ornate?: boolean;
  gem?: Style;
  /** Blade direction in the IDLE pose (world); default: the grip axis. */
  idleDir?: THREE.Vector3;
}

/** Sword in a fist: blade along the grip axis. */
export function sword(ctx: OutfitCtx, g: Grip, s: SwordLook): void {
  const { gear } = ctx;
  if (s.idleDir) {
    const M = ctx.idleToRest(ctx.src.bones[g.bone] ?? 'hand_r');
    const axis = s.idleDir.clone().normalize().transformDirection(M);
    // Keep the flat facing the palm as well as possible.
    const palm = g.palm.clone().addScaledVector(axis, -g.palm.dot(axis)).normalize();
    g = { ...g, axis, palm };
  }
  // y = blade axis, x = edge direction (along the knuckles), z = flat normal (palm).
  const [x, y, z] = basisY(g.axis, g.palm);
  const guardAt = g.o.clone().addScaledVector(g.axis, 0.065);
  const at = (d: number): THREE.Vector3 => g.o.clone().addScaledVector(g.axis, d);
  gear.add(new THREE.CylinderGeometry(0.014, 0.016, 0.17, 8), frame(at(0.0), x, y, z), s.grip, g.bone);
  gear.add(new THREE.IcosahedronGeometry(0.026, 0), frame(at(-0.095), x, y, z, [1, 0.8, 1]), s.pommel, g.bone);
  const gw = s.ornate ? 0.3 : 0.2;
  gear.add(flat(new THREE.BoxGeometry(gw, 0.028, 0.036)), frame(guardAt, x, y, z), s.guard, g.bone);
  if (s.ornate) {
    for (const k of [-1, 1]) {
      const tip = guardAt.clone().addScaledVector(x, k * gw * 0.5);
      gear.add(flat(new THREE.ConeGeometry(0.03, 0.1, 4)), alongY(tip.clone().addScaledVector(g.axis, 0.035), g.axis.clone().addScaledVector(x, k * 0.7)), s.guard, g.bone);
    }
  }
  if (s.gem) gear.add(new THREE.OctahedronGeometry(0.026), frame(guardAt, x, y, z, [1, 1, 0.9]), s.gem, g.bone);
  const b = blade(s.width, s.width * 0.22, 8, 0.86);
  gear.add(flat(b), frame(guardAt.clone().addScaledVector(g.axis, 0.012), x, y, z, [1, s.blade, 1]), s.steel, g.bone);
  if (s.rune) {
    const inlay = new THREE.BoxGeometry(s.width * 0.16, s.blade * 0.7, s.width * 0.25);
    gear.add(inlay, frame(guardAt.clone().addScaledVector(g.axis, s.blade * 0.42), x, y, z), s.rune, g.bone);
  }
}

/** Spear / glaive / trident shaft through a fist (head toward +axis). */
export function polearm(
  ctx: OutfitCtx,
  g: Grip,
  o: {
    length: number;
    back: number;
    shaft: Style;
    radius?: number;
    /** Shaft direction (head side) in the IDLE pose (world); default: the grip axis. */
    idleDir?: THREE.Vector3;
    head: (tip: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3) => void;
  },
): void {
  if (o.idleDir) {
    const M = ctx.idleToRest(ctx.src.bones[g.bone] ?? 'hand_r');
    g = { ...g, axis: o.idleDir.clone().normalize().transformDirection(M) };
  }
  const [x, y, z] = basisY(g.axis, g.palm.clone().negate());
  const r = o.radius ?? 0.014;
  const len = o.length;
  const start = g.o.clone().addScaledVector(g.axis, -o.back);
  ctx.gear.add(new THREE.CylinderGeometry(r, r * 1.1, len, 7), frame(start.clone().addScaledVector(g.axis, len / 2), x, y, z), o.shaft, g.bone);
  o.head(start.clone().addScaledVector(g.axis, len), g.axis.clone(), z);
}

// ---------------------------------------------------------------- shields

export interface ShieldLook {
  shape: 'round' | 'kite' | 'tower';
  size: number;
  face: Style;
  rim: Style;
  boss?: Style;
  emblem?: { style: Style; kind: 'star' | 'cross' | 'sun' | 'sigil' };
  /** Wood planks (Lv1 round shield). */
  planks?: Style;
  /** Face normal and "up" in the IDLE pose (world, unit facing +z); default: back of the hand / thumb. */
  pose?: { normal: THREE.Vector3; up: THREE.Vector3 };
  /** Distance of the face from the forearm axis (m). */
  out?: number;
}

/**
 * Shield strapped on the forearm: centred on the forearm, face toward the back of the hand.
 * The long axis follows `upHint` projected on the face plane.
 */
export function shield(ctx: OutfitCtx, side: Side, s: ShieldLook): void {
  const { gear } = ctx;
  const elbow = ctx.at(`lowerarm_${side}`);
  const wrist = ctx.at(`hand_${side}`);
  const g = grip(ctx, side);
  const fore = wrist.clone().sub(elbow);
  let n = g.palm.clone().negate(); // back of the hand
  let up = g.axis.clone();
  if (s.pose) {
    const M = ctx.idleToRest(`lowerarm_${side}`);
    n = s.pose.normal.clone().transformDirection(M);
    up = s.pose.up.clone().transformDirection(M);
  }
  const c = elbow.clone().addScaledVector(fore, 0.55).addScaledVector(n, s.out ?? 0.07);
  const [x, , zz] = basisY(up, n);
  const yy = new THREE.Vector3().crossVectors(zz, x).normalize();
  const bone = ctx.bone(`lowerarm_${side}`);
  const S = s.size;
  let outline: [number, number][];
  if (s.shape === 'round') {
    outline = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      outline.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]);
    }
  } else if (s.shape === 'kite') {
    outline = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (i / 12);
      outline.push([Math.cos(a) * 0.4, 0.18 + Math.sin(a) * 0.32]);
    }
    outline.push([-0.38, 0.0], [-0.2, -0.38], [0, -0.62], [0.2, -0.38], [0.38, 0.0]);
    outline.reverse();
  } else {
    outline = [
      [-0.36, 0.56],
      [0, 0.66],
      [0.36, 0.56],
      [0.38, -0.36],
      [0, -0.62],
      [-0.38, -0.36],
    ];
  }
  const scaled = outline.map(([px, py]) => [px * S, py * S] as [number, number]);
  // Slightly curved face: bow the plate around the vertical axis.
  const face = plate(scaled, 0.03 * S, 0.012 * S);
  bow(face, S * 0.9);
  gear.add(face, frame(c, x, yy, zz), s.planks ?? s.face, bone);
  // Rim: a slightly larger, thinner plate behind the face.
  const rimO = scaled.map(([px, py]) => [px * 1.08, py * 1.06] as [number, number]);
  const rim = plate(rimO, 0.022 * S, 0.008 * S);
  bow(rim, S * 0.9);
  gear.add(rim, frame(c.clone().addScaledVector(zz, -0.012 * S), x, yy, zz), s.rim, bone);
  if (s.planks) {
    // Painted team field over the planks (front, inner ring).
    const ring: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ring.push([Math.cos(a) * 0.36 * S, Math.sin(a) * 0.36 * S]);
    }
    const f = plate(ring, 0.006, 0);
    bow(f, S * 0.9);
    gear.add(f, frame(c.clone().addScaledVector(zz, 0.02 * S), x, yy, zz), s.face, bone);
  }
  if (s.boss) gear.add(new THREE.SphereGeometry(0.11 * S, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), frame(c.clone().addScaledVector(zz, 0.02 * S), x, zz, yy.clone().negate()), s.boss, bone);
  if (s.emblem) {
    let o: [number, number][];
    const k = s.emblem.kind;
    if (k === 'star') o = starOutline(4, 0.32);
    else if (k === 'sun') o = starOutline(8, 0.5);
    else if (k === 'sigil') o = starOutline(6, 0.42, Math.PI / 6);
    else
      o = [
        [-0.07, 0.5],
        [0.07, 0.5],
        [0.07, 0.14],
        [0.3, 0.14],
        [0.3, 0.0],
        [0.07, 0.0],
        [0.07, -0.5],
        [-0.07, -0.5],
        [-0.07, 0.0],
        [-0.3, 0.0],
        [-0.3, 0.14],
        [-0.07, 0.14],
      ];
    const es = s.shape === 'round' ? 0.5 : 0.55;
    const e = plate(o.map(([px, py]) => [px * S * es, py * S * es] as [number, number]), 0.012 * S, 0.004 * S);
    gear.add(e, frame(c.clone().addScaledVector(zz, 0.035 * S).addScaledVector(yy, s.shape === 'round' ? 0 : 0.05 * S), x, yy, zz), s.emblem.style, bone);
  }
}

/** Bend a plate (xy outline, z depth) back around its vertical axis (radius r). */
function bow(g: THREE.BufferGeometry, r: number): void {
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    P.setZ(i, P.getZ(i) - (x * x) / (2 * r));
  }
  g.computeVertexNormals();
}

// ---------------------------------------------------------------- cloth

export interface CapeLook {
  /** Rest-world y of the bottom edge. */
  bottom: number;
  widthTop: number;
  widthBottom: number;
  style: (u: number, v: number) => Style;
  /** Ragged / tattered bottom edge depth (m). */
  ragged?: number;
  /** Extra flare bones and sway. */
  sway?: number;
}

/** Cape hanging from the shoulders, skinned spine_03 -> two sway bones. */
export function cape(ctx: OutfitCtx, c: CapeLook): void {
  const chest = boxOf(ctx, 'Body', (v) => v.bone === 'spine_03');
  const yTop = chest.max.y - 0.04;
  const zTop = chest.min.z - 0.015;
  const len = yTop - c.bottom;
  ctx.addBone('fx_capeA', 'spine_03', V(0, yTop, zTop));
  ctx.addBone('fx_capeB', 'fx_capeA', V(0, yTop - len * 0.5, zTop - 0.08));
  const sw = c.sway ?? 1;
  ctx.secondary.push(
    { bone: 'fx_capeA', axis: [1, 0, 0], idleAmp: 0.03 * sw, idleFreq: 1.5, run: 0.55, phase: 0, hang: 0.8 },
    { bone: 'fx_capeB', axis: [1, 0, 0], idleAmp: 0.06 * sw, idleFreq: 1.5, run: 0.35, phase: 0.9, hang: 0.6 },
  );
  const sp = ctx.bone('spine_03');
  const a = ctx.bone('fx_capeA');
  const b = ctx.bone('fx_capeB');
  const skin: SkinFn = (p) => {
    const s = clamp01((yTop - p.y) / len);
    if (s < 0.15) return { a: sp, b: a, t: s / 0.15 };
    return { a, b, t: clamp01((s - 0.3) / 0.5) };
  };
  const nu = 12;
  const nv = 10;
  const g = sheet(nu, nv, (u, v, out) => {
    const x = (u * 2 - 1) * lerp(c.widthTop, c.widthBottom, v);
    const bulge = 0.07 * (1 - (u * 2 - 1) ** 2);
    const fold = 0.022 * Math.sin(u * Math.PI * 6) * v;
    let vv = v;
    if (c.ragged && v === 1) vv = 1 - (c.ragged / len) * (0.5 + 0.5 * Math.sin(u * 37.0));
    out.set(x, yTop - vv * len, zTop - 0.01 - bulge * (0.3 + 0.7 * vv) - vv * 0.12 + fold);
  }, 0.01);
  // Per-vertex style by the sheet coordinate (u from the lookup; v from the height).
  const styles = new Map<string, Style>();
  ctx.gear.add(g, null, (p) => {
    const v = clamp01((yTop - p.y) / len);
    const u = clamp01((p.x / Math.max(1e-4, lerp(c.widthTop, c.widthBottom, v)) + 1) / 2);
    const s = c.style(u, v);
    const k = JSON.stringify(s);
    let o = styles.get(k);
    if (!o) {
      o = s;
      styles.set(k, o);
    }
    return o;
  }, skin);
}

/** Feather / horsehair plume: a fan of blades along an arc, on its own sway bone. */
export function plume(
  ctx: OutfitCtx,
  o: { base: THREE.Vector3; parent: string; count: number; length: number; width: number; style: (i: number) => Style; arc?: [number, number]; back?: number },
): void {
  ctx.addBone('fx_plume', o.parent, o.base);
  ctx.secondary.push({ bone: 'fx_plume', axis: [1, 0, 0], idleAmp: 0.05, idleFreq: 2.0, run: 0.25, phase: 0.3 });
  const bone = ctx.bone('fx_plume');
  const [a0, a1] = o.arc ?? [-0.2, 1.7];
  for (let i = 0; i < o.count; i++) {
    const t = o.count === 1 ? 0.5 : i / (o.count - 1);
    const phi = lerp(a0, a1, t);
    const dir = V(0, Math.cos(phi), -Math.sin(phi) * 1.1).lerp(V(0, 0.2, -1), (o.back ?? 0.35) * t).normalize();
    const p = o.base.clone().addScaledVector(V(0, Math.cos(phi) * 0.4, -Math.sin(phi) * 0.4), o.width);
    const len = o.length * (1 - 0.35 * t);
    ctx.gear.add(blade(o.width, o.width * 0.45, 6, 0.35), alongY(p, dir, [1, len, 1]), o.style(i), bone);
  }
}

/** Curved horn: tapered tube from `root` along a bezier through `mid` to `tip`. */
export function horn(ctx: OutfitCtx, pts: THREE.Vector3[], r0: number, style: Style | ((t: number) => Style), bone: number, seg = 10): void {
  if (typeof style !== 'function') {
    ctx.gear.add(taperTube(pts, (t) => r0 * (1 - t * 0.92), seg, 7), null, style, bone);
    return;
  }
  // Banded horn (tip styled differently): split in 3 parts.
  const curve = new THREE.CatmullRomCurve3(pts);
  const cuts = [0, 0.45, 0.75, 1];
  for (let k = 0; k < 3; k++) {
    const sub: THREE.Vector3[] = [];
    for (let i = 0; i <= 4; i++) sub.push(curve.getPoint(lerp(cuts[k], cuts[k + 1], i / 4)));
    const ta = cuts[k];
    const tb = cuts[k + 1];
    ctx.gear.add(taperTube(sub, (t) => r0 * (1 - lerp(ta, tb, t) * 0.92), 6, 7), null, style((ta + tb) / 2), bone);
  }
}

/** A tint shortcut. */
export const st = (color: Tint, extra: Partial<Style> = {}): Style => ({ color, ...extra });
export const P = PATTERN;
export { smooth };
