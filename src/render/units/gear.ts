/**
 * Procedural gear for the glTF units (weapons, shields, helmets, capes, horns, plumes, ...), authored
 * in REST-POSE WORLD space of the (bone-scaled) character and skinned to its bones (rigidly, or
 * blended between two bones for cloth). build() converts it to bind space (exact inverse of the
 * blended rest skin transform) so it lands in the unit's single merged skinned mesh: extra detail
 * costs vertices, not draw calls. Build-time only (cached per template).
 */
import * as THREE from 'three';
import { PartWriter, type Part } from './body';
import type { Style } from './style';

/** Per-vertex skinning: up to two bones (indices into the unit skeleton). */
export interface SkinPick {
  a: number;
  b?: number;
  /** Weight of `b` (0..1). */
  t?: number;
}

export type SkinFn = (p: THREE.Vector3) => SkinPick;

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpNM = new THREE.Matrix3();
const tmpW = new THREE.Matrix4();

export class GearBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly styles: Style[] = [];
  private readonly styleOf: number[] = [];
  private readonly boneA: number[] = [];
  private readonly boneB: number[] = [];
  private readonly wB: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.boneA.length;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Add a geometry (disposed afterwards) transformed by `m` into rest world space. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, style: Style | ((p: THREE.Vector3) => Style), skin: number | SkinFn): void {
    const P = geo.attributes.position;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const N = geo.attributes.normal;
    const base = this.boneA.length;
    if (m) tmpNM.getNormalMatrix(m);
    const fixed = typeof style === 'function' ? -1 : this.styles.push(style) - 1;
    const styleAt = typeof style === 'function' ? style : null;
    const seen = new Map<Style, number>();
    for (let i = 0; i < P.count; i++) {
      tmpV.fromBufferAttribute(P, i);
      tmpN.fromBufferAttribute(N, i);
      if (m) {
        tmpV.applyMatrix4(m);
        tmpN.applyMatrix3(tmpNM).normalize();
      }
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      if (styleAt) {
        const st = styleAt(tmpV);
        let k = seen.get(st);
        if (k === undefined) {
          k = this.styles.push(st) - 1;
          seen.set(st, k);
        }
        this.styleOf.push(k);
      } else this.styleOf.push(fixed);
      if (typeof skin === 'number') {
        this.boneA.push(skin);
        this.boneB.push(-1);
        this.wB.push(0);
      } else {
        const s = skin(tmpV);
        this.boneA.push(s.a);
        this.boneB.push(s.b ?? -1);
        this.wB.push(s.b !== undefined ? (s.t ?? 0) : 0);
      }
    }
    if (geo.index) {
      for (let k = 0; k < geo.index.count; k++) this.idx.push(geo.index.getX(k) + base);
    } else {
      for (let k = 0; k < P.count; k++) this.idx.push(k + base);
    }
    geo.dispose();
  }

  /**
   * Bind-space part. `skinM[j]` = bone_j.matrixWorld * boneInverse_j at rest (identity unless the
   * bones are scaled): v_bind = (sum_k w_k skinM_k)^-1 * v_world.
   */
  build(skinM: THREE.Matrix4[]): Part | null {
    const n = this.boneA.length;
    if (n === 0) return null;
    const w = new PartWriter();
    const si = [0, 0, 0, 0];
    const sw = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const a = this.boneA[i];
      const b = this.boneB[i];
      const t = b >= 0 ? this.wB[i] : 0;
      const e = tmpW.elements;
      const ea = skinM[a].elements;
      if (b >= 0 && t > 0) {
        const eb = skinM[b].elements;
        for (let q = 0; q < 16; q++) e[q] = ea[q] * (1 - t) + eb[q] * t;
      } else {
        for (let q = 0; q < 16; q++) e[q] = ea[q];
      }
      tmpW.invert();
      tmpNM.getNormalMatrix(tmpW);
      tmpV.fromArray(this.pos, i * 3).applyMatrix4(tmpW);
      tmpN.fromArray(this.nor, i * 3).applyMatrix3(tmpNM).normalize();
      si[0] = a;
      sw[0] = 1 - t;
      si[1] = b >= 0 ? b : 0;
      sw[1] = b >= 0 ? t : 0;
      w.vertexSkin(tmpV, tmpN, this.styles[this.styleOf[i]], si, sw);
    }
    for (let k = 0; k < this.idx.length; k += 3) w.tri(this.idx[k], this.idx[k + 1], this.idx[k + 2]);
    return w.part();
  }
}

// ---------------------------------------------------------------- transforms

const E = new THREE.Euler();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const T = new THREE.Vector3();

/** Compose a TRS matrix (euler XYZ radians, scale number or [x,y,z]). */
export function trs(
  p: THREE.Vector3 | [number, number, number],
  r: [number, number, number] = [0, 0, 0],
  s: number | [number, number, number] = 1,
): THREE.Matrix4 {
  if (Array.isArray(p)) T.set(p[0], p[1], p[2]);
  else T.copy(p);
  E.set(r[0], r[1], r[2]);
  Q.setFromEuler(E);
  if (typeof s === 'number') S.set(s, s, s);
  else S.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(T, Q, S);
}

/** Matrix that maps +y onto `dir` (normalised) and places the origin at `p`, scaled. */
export function alongY(p: THREE.Vector3, dir: THREE.Vector3, s: number | [number, number, number] = 1): THREE.Matrix4 {
  Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  if (typeof s === 'number') S.set(s, s, s);
  else S.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(p, Q, S);
}

// ---------------------------------------------------------------- shapes

/** Flat-shaded copy (crisper hard-surface read at small sizes). */
export function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  ng.computeVertexNormals();
  return ng;
}

/** Leaf/feather blade: flattened diamond lathe along +y, length 1, width w, thickness th. */
export function blade(w: number, th: number, seg = 6, tip = 0.62): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const r = t < tip ? Math.sin((t / tip) * Math.PI * 0.5) : Math.cos(((t - tip) / (1 - tip)) * Math.PI * 0.5);
    pts.push(new THREE.Vector2(Math.max(0.001, r * 0.5), t));
  }
  const g = new THREE.LatheGeometry(pts, 4);
  g.rotateY(Math.PI / 4);
  g.scale(w * 1.41, 1, th * 1.41);
  return g;
}

/** Tapered tube along a curve; radius(t) gives the radius at t in 0..1. */
export function taperTube(
  pts: THREE.Vector3[],
  radius: (t: number) => number,
  seg = 12,
  radial = 6,
  flatten = 1,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const P = g.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  const frames = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    const r = Math.max(0.0005, radius(t));
    const bn = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(P, k).sub(c);
      // Squash along the binormal for blade-like plumes / tails.
      const along = v.dot(bn);
      v.addScaledVector(bn, along * (flatten - 1));
      v.multiplyScalar(r).add(c);
      P.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Cloth sheet: grid u (across, 0..1) x v (down, 0..1) mapped through `at(u, v, out)`; double
 * sided (back faces get their own normals so the material can stay single-sided).
 */
export function sheet(nu: number, nv: number, at: (u: number, v: number, out: THREE.Vector3) => void, thickness = 0.012): THREE.BufferGeometry {
  const front: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      at(i / nu, j / nv, p);
      front.push(p.x, p.y, p.z);
    }
  }
  const idx: number[] = [];
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(front, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Back side, offset along -normal.
  const n = g.attributes.normal;
  const count = front.length / 3;
  const pos2 = new Float32Array(count * 6);
  const nor2 = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const nk = n.getComponent(i, k);
      pos2[i * 3 + k] = front[i * 3 + k];
      nor2[i * 3 + k] = nk;
      pos2[(count + i) * 3 + k] = front[i * 3 + k] - nk * thickness;
      nor2[(count + i) * 3 + k] = -nk;
    }
  }
  const idx2 = idx.slice();
  for (let k = 0; k < idx.length; k += 3) idx2.push(idx[k] + count, idx[k + 2] + count, idx[k + 1] + count);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor2, 3));
  out.setIndex(idx2);
  g.dispose();
  return out;
}

/** Extruded 2D outline (x,y in the xy-plane, extruded along z by `depth`, centred), bevelled. */
export function plate(outline: [number, number][], depth: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute('uv');
  return g;
}

/** Regular star/cross emblem outlines (xy, unit size). */
export function starOutline(points: number, inner: number, rot = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    out.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  return out;
}

export function crossOutline(arm: number): [number, number][] {
  const a = arm / 2;
  return [
    [-a, 0.5],
    [a, 0.5],
    [a, a + 0.08],
    [0.36, a + 0.08],
    [0.36, a - 0.12],
    [a, a - 0.12],
    [a, -0.5],
    [-a, -0.5],
    [-a, a - 0.12],
    [-0.36, a - 0.12],
    [-0.36, a + 0.08],
    [-a, a + 0.08],
  ];
}

/** Mix two sRGB hex colours (t = 0 -> a). Returns a hex string. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, t).getHexString();
}
