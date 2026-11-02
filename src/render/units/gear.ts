/**
 * Procedural gear for the glTF units, authored in REST-POSE WORLD space of the (bone-scaled)
 * character scene and skinned to its bones (rigidly, or blended between two bones for cloth).
 * Everything ends up in the unit's single merged skinned mesh (merge.ts, `world` parts), so the
 * extra detail costs vertices, not draw calls. Build-time only (cached per template).
 */
import * as THREE from 'three';

export interface GearStyle {
  /** sRGB colour. */
  color: THREE.ColorRepresentation;
  /** Emissive strength (0..2). */
  glow?: number;
  /** Metal look (0..1). */
  metal?: number;
  /** Pattern id (material.ts PATTERN). */
  pattern?: number;
}

/** Per-vertex skinning: up to two bones. */
export interface SkinPick {
  a: THREE.Bone;
  b?: THREE.Bone;
  /** Weight of `b` (0..1). */
  t?: number;
}

export type SkinFn = (p: THREE.Vector3) => SkinPick;

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpNM = new THREE.Matrix3();
const tmpC = new THREE.Color();

export class GearBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly fx: number[] = [];
  private readonly boneA: THREE.Bone[] = [];
  private readonly boneB: (THREE.Bone | null)[] = [];
  private readonly wB: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.boneA.length;
  }

  /** Add a geometry (disposed afterwards) transformed by `m` into rest world space. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, style: GearStyle, skin: THREE.Bone | SkinFn): void {
    const P = geo.attributes.position;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const N = geo.attributes.normal;
    const base = this.boneA.length;
    if (m) tmpNM.getNormalMatrix(m);
    tmpC.set(style.color);
    const glow = style.glow ?? 0;
    const metal = style.metal ?? 0;
    const pattern = style.pattern ?? 0;
    for (let i = 0; i < P.count; i++) {
      tmpV.fromBufferAttribute(P, i);
      tmpN.fromBufferAttribute(N, i);
      if (m) {
        tmpV.applyMatrix4(m);
        tmpN.applyMatrix3(tmpNM).normalize();
      }
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      this.col.push(tmpC.r, tmpC.g, tmpC.b);
      this.fx.push(glow, metal, pattern, 0);
      if (skin instanceof THREE.Bone) {
        this.boneA.push(skin);
        this.boneB.push(null);
        this.wB.push(0);
      } else {
        const s = skin(tmpV);
        this.boneA.push(s.a);
        this.boneB.push(s.b ?? null);
        this.wB.push(s.b ? (s.t ?? 0) : 0);
      }
    }
    if (geo.index) {
      for (let k = 0; k < geo.index.count; k++) this.idx.push(geo.index.getX(k) + base);
    } else {
      for (let k = 0; k < P.count; k++) this.idx.push(k + base);
    }
    geo.dispose();
  }

  /** A mesh carrying the gear (world-space, skin attributes for `skeleton`), or null if empty. */
  build(skeleton: THREE.Skeleton): THREE.Mesh | null {
    const n = this.boneA.length;
    if (n === 0) return null;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const lookup = new Map<THREE.Bone, number>();
    skeleton.bones.forEach((b, i) => lookup.set(b, i));
    for (let i = 0; i < n; i++) {
      const a = lookup.get(this.boneA[i]) ?? 0;
      const bb = this.boneB[i];
      const t = bb ? this.wB[i] : 0;
      si[i * 4] = a;
      sw[i * 4] = 1 - t;
      if (bb) {
        si[i * 4 + 1] = lookup.get(bb) ?? a;
        sw[i * 4 + 1] = t;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(this.fx, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    const mesh = new THREE.Mesh(g);
    mesh.userData.generated = true;
    return mesh;
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

// ---------------------------------------------------------------- body measurement

/** Rest-pose world positions of a character's body vertices (with an optional tag per vertex). */
export class BodyCloud {
  readonly points: THREE.Vector3[] = [];
  readonly tags: number[] = [];

  addSkinned(mesh: THREE.SkinnedMesh, tag: (i: number) => number = () => 0): void {
    const P = mesh.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const v = new THREE.Vector3();
      mesh.getVertexPosition(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      this.points.push(v);
      this.tags.push(tag(i));
    }
  }

  /** Bounds of points matching a filter. */
  box(filter: (p: THREE.Vector3, tag: number) => boolean): THREE.Box3 {
    const b = new THREE.Box3();
    for (let i = 0; i < this.points.length; i++) if (filter(this.points[i], this.tags[i])) b.expandByPoint(this.points[i]);
    return b;
  }

  /** Ellipse fit (centre + half extents in x/z) of the slice |y - y0| < band. */
  sliceY(y0: number, band: number, tagOk: (t: number) => boolean = () => true): { cx: number; cz: number; rx: number; rz: number } {
    const b = this.box((p, t) => Math.abs(p.y - y0) < band && tagOk(t));
    if (b.isEmpty()) return { cx: 0, cz: 0, rx: 0.1, rz: 0.1 };
    return { cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, rx: (b.max.x - b.min.x) / 2, rz: (b.max.z - b.min.z) / 2 };
  }

  /** Slice across z (quadrupeds): centre y + half extents in x/y of |z - z0| < band. */
  sliceZ(z0: number, band: number, tagOk: (t: number) => boolean = () => true, yMin = -Infinity): { cx: number; cy: number; rx: number; ry: number; top: number } {
    const b = this.box((p, t) => Math.abs(p.z - z0) < band && p.y > yMin && tagOk(t));
    if (b.isEmpty()) return { cx: 0, cy: 0, rx: 0.1, ry: 0.1, top: 0 };
    return { cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2, rx: (b.max.x - b.min.x) / 2, ry: (b.max.y - b.min.y) / 2, top: b.max.y };
  }
}

/** World position of a named object. */
export function worldPos(root: THREE.Object3D, name: string): THREE.Vector3 {
  const o = root.getObjectByName(name);
  const v = new THREE.Vector3();
  if (o) o.getWorldPosition(v);
  return v;
}

/** World-space bounds of a (rigid) mesh by name. */
export function meshBox(root: THREE.Object3D, name: string): THREE.Box3 {
  const m = root.getObjectByName(name) as THREE.Mesh | undefined;
  const b = new THREE.Box3();
  if (!m || !m.isMesh) return b;
  const P = m.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) b.expandByPoint(v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld));
  return b;
}

/** Mix two sRGB hex colours (t = 0 -> a). Returns a hex string. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, t).getHexString();
}
