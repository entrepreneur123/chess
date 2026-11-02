/**
 * Body sources and geometry assembly for the glTF units.
 *
 * BodySource: the skinned meshes of one body file (hero.glb / imp.glb) normalised ONCE into plain
 * float arrays in the rest-pose ("bind") space of a canonical bone list (quantization folded away),
 * plus each vertex's dominant bone. Every template of every view builds from these arrays.
 *
 * Armour shells (ShellBuilder): a region of a source mesh (vertices picked by bone / position) is
 * welded, optionally smoothed (muscles melt into plate), pushed out along its normals and emitted
 * with the SAME skin weights, so the armour hugs the sculpted body and deforms exactly with it.
 * Shell borders get a rolled trim (tube along the smoothed boundary loops); covered body triangles
 * are dropped (no overdraw, no poke-through, no extra triangles).
 *
 * Part: plain bind-space geometry (position, normal, uv, color, aFx, skinIndex, skinWeight, index);
 * assemble() concatenates parts into the unit's single skinned BufferGeometry.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { resolveStyle, type Style } from './style';

export interface Part {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  fx: Float32Array;
  si: Uint16Array;
  sw: Float32Array;
  index: Uint32Array;
}

export interface SrcMesh {
  name: string;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  /** Baked vertex colour (linear) or null (texture only). */
  col: Float32Array | null;
  si: Uint16Array;
  sw: Float32Array;
  index: Uint32Array;
  /** Dominant bone (canonical index) per vertex. */
  dom: Uint16Array;
  /** Welded topology (lazy). */
  weld?: Weld;
}

interface Weld {
  /** Vertex -> weld id. */
  id: Int32Array;
  /** Weld id -> representative vertex. */
  rep: Int32Array;
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpNM = new THREE.Matrix3();

export class BodySource {
  readonly bones: string[] = [];
  readonly boneIndex = new Map<string, number>();
  /** Inverse rest world matrix per canonical bone. */
  readonly bindInv: THREE.Matrix4[] = [];
  /** Rest world matrix per canonical bone. */
  readonly rest: THREE.Matrix4[] = [];
  readonly meshes = new Map<string, SrcMesh>();
  /** Bone parent (canonical index, -1 for the root). */
  readonly parent: number[] = [];

  constructor(gltf: GLTF) {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const skinned: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    if (!skinned.length) throw new Error('body: no skinned mesh');
    const boneObj: THREE.Bone[] = [];
    const objIndex = new Map<THREE.Object3D, number>();
    for (const b of skinned[0].skeleton.bones) {
      objIndex.set(b, boneObj.length);
      boneObj.push(b);
      this.boneIndex.set(b.name, this.bones.length);
      this.bones.push(b.name);
      this.rest.push(b.matrixWorld.clone());
      this.bindInv.push(b.matrixWorld.clone().invert());
    }
    for (const b of boneObj) this.parent.push(b.parent ? (objIndex.get(b.parent) ?? -1) : -1);
    for (const sm of skinned) this.meshes.set(sm.name, this.normalise(sm, objIndex));
  }

  private normalise(sm: THREE.SkinnedMesh, objIndex: Map<THREE.Object3D, number>): SrcMesh {
    const g = sm.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const UV = g.attributes.uv;
    const C = g.attributes.color;
    const SI = g.attributes.skinIndex;
    const SW = g.attributes.skinWeight;
    const n = P.count;
    const skel = sm.skeleton;
    // Per joint: rest world skin matrix of this mesh (bone.mw * own inverse * bindMatrix).
    const skinM = skel.bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, skel.boneInverses[j]).multiply(sm.bindMatrix));
    const remap = skel.bones.map((b) => objIndex.get(b) ?? 0);
    const out: SrcMesh = {
      name: sm.name,
      pos: new Float32Array(n * 3),
      nor: new Float32Array(n * 3),
      uv: new Float32Array(n * 2),
      col: C ? new Float32Array(n * 3) : null,
      si: new Uint16Array(n * 4),
      sw: new Float32Array(n * 4),
      index: new Uint32Array(g.index ? g.index.count : n),
      dom: new Uint16Array(n),
    };
    for (let i = 0; i < n; i++) {
      const e = tmpM.elements;
      e.fill(0);
      let best = -1;
      let bestW = -1;
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = SW.getComponent(i, k);
        const j = SI.getComponent(i, k);
        out.si[i * 4 + k] = remap[j];
        out.sw[i * 4 + k] = w;
        sum += w;
        if (w <= 0) continue;
        const me = skinM[j].elements;
        for (let q = 0; q < 16; q++) e[q] += me[q] * w;
        if (w > bestW) {
          bestW = w;
          best = remap[j];
        }
      }
      if (sum > 0) for (let k = 0; k < 4; k++) out.sw[i * 4 + k] /= sum;
      out.dom[i] = Math.max(0, best);
      tmpV.fromBufferAttribute(P, i).applyMatrix4(tmpM);
      out.pos.set([tmpV.x, tmpV.y, tmpV.z], i * 3);
      tmpNM.getNormalMatrix(tmpM);
      tmpN.fromBufferAttribute(N, i).applyMatrix3(tmpNM).normalize();
      out.nor.set([tmpN.x, tmpN.y, tmpN.z], i * 3);
      if (UV) {
        out.uv[i * 2] = UV.getX(i);
        out.uv[i * 2 + 1] = UV.getY(i);
      }
      if (C && out.col) out.col.set([C.getX(i), C.getY(i), C.getZ(i)], i * 3);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) out.index[k] = g.index.getX(k);
    else for (let k = 0; k < n; k++) out.index[k] = k;
    return out;
  }

  mesh(name: string): SrcMesh {
    const m = this.meshes.get(name);
    if (!m) throw new Error(`body: mesh ${name} missing`);
    return m;
  }

  bone(name: string): number {
    const i = this.boneIndex.get(name);
    if (i === undefined) throw new Error(`body: bone ${name} missing`);
    return i;
  }

  /** Canonical indices of every bone whose name matches. */
  bonesMatching(re: RegExp): Set<number> {
    const s = new Set<number>();
    this.bones.forEach((n, i) => {
      if (re.test(n)) s.add(i);
    });
    return s;
  }

  /** Rest world position of a bone. */
  bonePos(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    return out.setFromMatrixPosition(this.rest[this.bone(name)]);
  }
}

/** Welded topology of a source mesh (vertices sharing a position). */
export function weldOf(m: SrcMesh): Weld {
  if (m.weld) return m.weld;
  const n = m.pos.length / 3;
  const id = new Int32Array(n);
  const reps: number[] = [];
  const map = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(m.pos[i * 3] * 1e4)},${Math.round(m.pos[i * 3 + 1] * 1e4)},${Math.round(m.pos[i * 3 + 2] * 1e4)}`;
    let w = map.get(k);
    if (w === undefined) {
      w = reps.length;
      reps.push(i);
      map.set(k, w);
    }
    id[i] = w;
  }
  m.weld = { id, rep: Int32Array.from(reps) };
  return m.weld;
}

// ---------------------------------------------------------------- vertex queries

/** Per-vertex view used by region predicates (rest pose, unscaled). */
export interface VInfo {
  i: number;
  p: THREE.Vector3;
  n: THREE.Vector3;
  /** Dominant bone name. */
  bone: string;
  /** Total weight on bones accepted by a set. */
  w(set: Set<number>): number;
}

export function forEachVertex(src: BodySource, m: SrcMesh, fn: (v: VInfo) => void): void {
  const p = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const v: VInfo = {
    i: 0,
    p,
    n: nn,
    bone: '',
    w(set) {
      let s = 0;
      for (let k = 0; k < 4; k++) if (set.has(m.si[this.i * 4 + k])) s += m.sw[this.i * 4 + k];
      return s;
    },
  };
  const n = m.pos.length / 3;
  for (let i = 0; i < n; i++) {
    v.i = i;
    p.fromArray(m.pos, i * 3);
    nn.fromArray(m.nor, i * 3);
    v.bone = src.bones[m.dom[i]];
    fn(v);
  }
}

/** Vertex mask of a predicate. */
export function vertexMask(src: BodySource, m: SrcMesh, pred: (v: VInfo) => boolean): Uint8Array {
  const mask = new Uint8Array(m.pos.length / 3);
  forEachVertex(src, m, (v) => {
    mask[v.i] = pred(v) ? 1 : 0;
  });
  return mask;
}

/** Triangle mask: triangles with at least `need` (1..3) selected vertices. */
export function triMask(m: SrcMesh, vmask: Uint8Array, need = 3): Uint8Array {
  const t = new Uint8Array(m.index.length / 3);
  for (let k = 0; k < t.length; k++) {
    const s = vmask[m.index[k * 3]] + vmask[m.index[k * 3 + 1]] + vmask[m.index[k * 3 + 2]];
    t[k] = s >= need ? 1 : 0;
  }
  return t;
}

// ---------------------------------------------------------------- shells

export interface ShellSpec {
  /** Selected triangles of the source mesh. */
  tris: Uint8Array;
  /** Push-out distance (m, rest scale) or per-vertex function of the smoothed position / normal. */
  offset: number | ((p: THREE.Vector3, n: THREE.Vector3) => number);
  /** Laplacian smoothing iterations of the interior (0 = keep the sculpt). */
  smooth?: number;
  /** Smoothing iterations of the border loops. */
  smoothBorder?: number;
  style: Style | ((p: THREE.Vector3, n: THREE.Vector3) => Style);
  /** Rolled trim along the borders. */
  rim?: { radius: number; style: Style; sides?: number };
  /** Force every vertex onto one bone (rigid plate) or blend two bones by a function. */
  rigid?: number;
  /** Scale the result about a point (rest space) before output. */
  inflate?: { center: THREE.Vector3; scale: [number, number, number] };
}

/** Build an armour shell (bind space) from triangles of a source mesh. */
export function buildShell(m: SrcMesh, spec: ShellSpec): Part | null {
  const weld = weldOf(m);
  const local = new Int32Array(weld.rep.length).fill(-1);
  const reps: number[] = [];
  const tri: number[] = [];
  for (let k = 0; k < spec.tris.length; k++) {
    if (!spec.tris[k]) continue;
    const i0 = weld.id[m.index[k * 3]];
    const i1 = weld.id[m.index[k * 3 + 1]];
    const i2 = weld.id[m.index[k * 3 + 2]];
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    for (const w of [i0, i1, i2]) {
      let l = local[w];
      if (l < 0) {
        l = reps.length;
        local[w] = l;
        reps.push(weld.rep[w]);
      }
      tri.push(l);
    }
  }
  const n = reps.length;
  if (!n) return null;
  const P = new Float32Array(n * 3);
  reps.forEach((r, i) => P.set(m.pos.subarray(r * 3, r * 3 + 3), i * 3));
  // Edges (sorted numeric keys): neighbour lists (CSR) + boundary edges (used by one triangle).
  const ec = tri.length;
  const keys = new Float64Array(ec);
  for (let k = 0; k < tri.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tri[k + e];
      const b = tri[k + ((e + 1) % 3)];
      keys[k + e] = a < b ? a * n + b : b * n + a;
    }
  }
  keys.sort();
  const deg = new Int32Array(n + 1);
  const bdeg = new Int32Array(n);
  const uniq: number[] = [];
  const isBorder: boolean[] = [];
  for (let i = 0; i < ec; ) {
    let j = i + 1;
    while (j < ec && keys[j] === keys[i]) j++;
    const key = keys[i];
    const a = Math.floor(key / n);
    const b = key - a * n;
    uniq.push(a, b);
    isBorder.push(j - i === 1);
    deg[a]++;
    deg[b]++;
    if (j - i === 1) {
      bdeg[a]++;
      bdeg[b]++;
    }
    i = j;
  }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const fill = start.slice(0, n);
  const adj = new Int32Array(start[n]);
  const bnbr: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < isBorder.length; e++) {
    const a = uniq[e * 2];
    const b = uniq[e * 2 + 1];
    adj[fill[a]++] = b;
    adj[fill[b]++] = a;
    if (isBorder[e]) {
      bnbr[a].push(b);
      bnbr[b].push(a);
    }
  }
  // Interior smoothing (border fixed), then border loop smoothing.
  const tmp = new Float32Array(n * 3);
  const it = spec.smooth ?? 0;
  for (let s = 0; s < it; s++) {
    tmp.set(P);
    for (let i = 0; i < n; i++) {
      const c = start[i + 1] - start[i];
      if (bdeg[i] > 0 || c === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let q = start[i]; q < start[i + 1]; q++) {
        const j = adj[q];
        x += tmp[j * 3];
        y += tmp[j * 3 + 1];
        z += tmp[j * 3 + 2];
      }
      P[i * 3] = tmp[i * 3] * 0.4 + (x / c) * 0.6;
      P[i * 3 + 1] = tmp[i * 3 + 1] * 0.4 + (y / c) * 0.6;
      P[i * 3 + 2] = tmp[i * 3 + 2] * 0.4 + (z / c) * 0.6;
    }
  }
  for (let s = 0; s < (spec.smoothBorder ?? 3); s++) {
    tmp.set(P);
    for (let i = 0; i < n; i++) {
      if (bnbr[i].length !== 2) continue;
      const [a, b] = bnbr[i];
      for (let k = 0; k < 3; k++) P[i * 3 + k] = tmp[i * 3 + k] * 0.5 + (tmp[a * 3 + k] + tmp[b * 3 + k]) * 0.25;
    }
  }
  // Normals of the smoothed surface.
  const NRM = new Float32Array(n * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let k = 0; k < tri.length; k += 3) {
    a.fromArray(P, tri[k] * 3);
    b.fromArray(P, tri[k + 1] * 3).sub(a);
    c.fromArray(P, tri[k + 2] * 3).sub(a);
    b.cross(c);
    for (let e = 0; e < 3; e++) {
      const i = tri[k + e];
      NRM[i * 3] += b.x;
      NRM[i * 3 + 1] += b.y;
      NRM[i * 3 + 2] += b.z;
    }
  }
  // Source normals orient the result (the welded source may have inconsistent winding).
  const pp = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    nn.fromArray(NRM, i * 3);
    const sn = tmpN.fromArray(m.nor, reps[i] * 3);
    if (nn.lengthSq() < 1e-12) nn.copy(sn);
    nn.normalize();
    if (nn.dot(sn) < 0) nn.negate();
    nn.toArray(NRM, i * 3);
  }
  const base = new Float32Array(P);
  const off = spec.offset;
  for (let i = 0; i < n; i++) {
    pp.fromArray(P, i * 3);
    nn.fromArray(NRM, i * 3);
    const d = typeof off === 'number' ? off : off(pp, nn);
    pp.addScaledVector(nn, d);
    if (spec.inflate) {
      const cc = spec.inflate.center;
      const sc = spec.inflate.scale;
      pp.set(cc.x + (pp.x - cc.x) * sc[0], cc.y + (pp.y - cc.y) * sc[1], cc.z + (pp.z - cc.z) * sc[2]);
    }
    pp.toArray(P, i * 3);
  }
  const out = new PartWriter();
  const vo = out.count;
  for (let i = 0; i < n; i++) {
    pp.fromArray(P, i * 3);
    nn.fromArray(NRM, i * 3);
    const st = typeof spec.style === 'function' ? spec.style(pp, nn) : spec.style;
    out.vertex(pp, nn, 0, 0, st, m, reps[i], spec.rigid);
  }
  // Winding: keep the source orientation unless it disagrees with the normals.
  for (let k = 0; k < tri.length; k += 3) {
    a.fromArray(P, tri[k] * 3);
    b.fromArray(P, tri[k + 1] * 3).sub(a);
    c.fromArray(P, tri[k + 2] * 3).sub(a);
    b.cross(c);
    nn.fromArray(NRM, tri[k] * 3);
    if (b.dot(nn) >= 0) out.tri(vo + tri[k], vo + tri[k + 1], vo + tri[k + 2]);
    else out.tri(vo + tri[k], vo + tri[k + 2], vo + tri[k + 1]);
  }
  if (spec.rim) addRims(out, m, reps, P, base, NRM, bnbr, spec.rim, spec.rigid);
  return out.part();
}

/** Tubes along the border loops of a shell (between the shell edge and the body). */
function addRims(
  out: PartWriter,
  m: SrcMesh,
  reps: number[],
  P: Float32Array,
  base: Float32Array,
  NRM: Float32Array,
  bnbr: number[][],
  rim: NonNullable<ShellSpec['rim']>,
  rigid?: number,
): void {
  const n = reps.length;
  const used = new Uint8Array(n);
  const sides = rim.sides ?? 5;
  const c = new THREE.Vector3();
  const t = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let s = 0; s < n; s++) {
    if (used[s] || bnbr[s].length !== 2) continue;
    // Walk the loop.
    const loop: number[] = [s];
    used[s] = 1;
    let prev = s;
    let cur = bnbr[s][0];
    let closed = false;
    while (cur !== undefined) {
      if (cur === s) {
        closed = true;
        break;
      }
      if (used[cur]) break;
      used[cur] = 1;
      loop.push(cur);
      const nx: number | undefined = bnbr[cur].find((x) => x !== prev);
      prev = cur;
      cur = nx as number;
      if (bnbr[prev].length !== 2) break;
    }
    if (loop.length < 3) continue;
    const L = loop.length;
    const ring0 = out.count;
    for (let k = 0; k < L; k++) {
      const i = loop[k];
      const ip = loop[(k - 1 + L) % L];
      const inx = loop[(k + 1) % L];
      // Tube centre halfway between the body surface and the shell edge.
      c.fromArray(P, i * 3).add(q.fromArray(base, i * 3)).multiplyScalar(0.5);
      t.fromArray(P, inx * 3).sub(q.fromArray(P, ip * 3)).normalize();
      nn.fromArray(NRM, i * 3);
      bb.crossVectors(t, nn).normalize();
      nn.crossVectors(bb, t).normalize();
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const px = c.x + (nn.x * ca + bb.x * sa) * rim.radius;
        const py = c.y + (nn.y * ca + bb.y * sa) * rim.radius;
        const pz = c.z + (nn.z * ca + bb.z * sa) * rim.radius;
        q.set(nn.x * ca + bb.x * sa, nn.y * ca + bb.y * sa, nn.z * ca + bb.z * sa);
        out.vertex(tmpV.set(px, py, pz), q, 0, 0, rim.style, m, reps[i], rigid);
      }
    }
    const segs = closed ? L : L - 1;
    for (let k = 0; k < segs; k++) {
      const r0 = ring0 + k * sides;
      const r1 = ring0 + ((k + 1) % L) * sides;
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        out.tri(r0 + j, r1 + j, r0 + j1);
        out.tri(r0 + j1, r1 + j, r1 + j1);
      }
    }
  }
}

// ---------------------------------------------------------------- part writer

/** Growable bind-space geometry. */
/** Growable typed array. */
class Grow<T extends Float32Array | Uint16Array | Uint32Array> {
  a: T;
  n = 0;
  constructor(private readonly make: (len: number) => T, cap = 1024) {
    this.a = make(cap);
  }
  reserve(k: number): void {
    if (this.n + k <= this.a.length) return;
    const b = this.make(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a.subarray(0, this.n) as never);
    this.a = b;
  }
  done(): T {
    return this.a.slice(0, this.n) as T;
  }
}

/** Growable bind-space geometry. */
export class PartWriter {
  private readonly pos = new Grow((l) => new Float32Array(l), 3072);
  private readonly nor = new Grow((l) => new Float32Array(l), 3072);
  private readonly uv = new Grow((l) => new Float32Array(l), 2048);
  private readonly col = new Grow((l) => new Float32Array(l), 3072);
  private readonly fx = new Grow((l) => new Float32Array(l), 4096);
  private readonly si = new Grow((l) => new Uint16Array(l), 4096);
  private readonly sw = new Grow((l) => new Float32Array(l), 4096);
  private readonly idx = new Grow((l) => new Uint32Array(l), 6144);
  private readonly c = new THREE.Color();
  private lastStyle: Style | null = null;
  private lastR = { glow: 0, metal: 0, pattern: 0, mode: 0 };
  private readonly lastC = new THREE.Color();

  get count(): number {
    return this.pos.n / 3;
  }

  private base(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, style: Style, color?: THREE.Color): void {
    this.pos.reserve(3);
    this.nor.reserve(3);
    this.uv.reserve(2);
    this.col.reserve(3);
    this.fx.reserve(4);
    this.si.reserve(4);
    this.sw.reserve(4);
    const P = this.pos.a;
    let o = this.pos.n;
    P[o] = p.x;
    P[o + 1] = p.y;
    P[o + 2] = p.z;
    this.pos.n += 3;
    const N = this.nor.a;
    o = this.nor.n;
    N[o] = n.x;
    N[o + 1] = n.y;
    N[o + 2] = n.z;
    this.nor.n += 3;
    this.uv.a[this.uv.n++] = u;
    this.uv.a[this.uv.n++] = v;
    if (style !== this.lastStyle) {
      const r = resolveStyle(style, this.lastC);
      this.lastR = { glow: r.glow, metal: r.metal, pattern: r.pattern, mode: r.mode };
      this.lastStyle = style;
    }
    this.c.copy(this.lastC);
    if (color) this.c.multiply(color);
    const C = this.col.a;
    o = this.col.n;
    C[o] = this.c.r;
    C[o + 1] = this.c.g;
    C[o + 2] = this.c.b;
    this.col.n += 3;
    const F = this.fx.a;
    o = this.fx.n;
    F[o] = this.lastR.glow;
    F[o + 1] = this.lastR.metal;
    F[o + 2] = this.lastR.pattern;
    F[o + 3] = this.lastR.mode;
    this.fx.n += 4;
  }

  /** A vertex skinned like source vertex `rep` of `m` (or rigidly to bone `rigid`). */
  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, style: Style, m: SrcMesh | null, rep: number, rigid?: number, color?: THREE.Color): void {
    this.base(p, n, u, v, style, color);
    const o = this.si.n;
    if (rigid !== undefined || !m) {
      this.si.a.set([rigid ?? 0, 0, 0, 0], o);
      this.sw.a.set([1, 0, 0, 0], o);
    } else {
      for (let k = 0; k < 4; k++) {
        this.si.a[o + k] = m.si[rep * 4 + k];
        this.sw.a[o + k] = m.sw[rep * 4 + k];
      }
    }
    this.si.n += 4;
    this.sw.n += 4;
  }

  /** A vertex with explicit skinning. */
  vertexSkin(p: THREE.Vector3, n: THREE.Vector3, style: Style, si: ArrayLike<number>, sw: ArrayLike<number>): void {
    this.base(p, n, 0, 0, style);
    const o = this.si.n;
    for (let k = 0; k < 4; k++) {
      this.si.a[o + k] = si[k] ?? 0;
      this.sw.a[o + k] = sw[k] ?? 0;
    }
    this.si.n += 4;
    this.sw.n += 4;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.reserve(3);
    const I = this.idx.a;
    I[this.idx.n] = a;
    I[this.idx.n + 1] = b;
    I[this.idx.n + 2] = c;
    this.idx.n += 3;
  }

  part(): Part {
    return {
      pos: this.pos.done(),
      nor: this.nor.done(),
      uv: this.uv.done(),
      col: this.col.done(),
      fx: this.fx.done(),
      si: this.si.done(),
      sw: this.sw.done(),
      index: this.idx.done(),
    };
  }
}

/**
 * Source triangles that survive (not hidden) as a part, with a per-vertex style function
 * (textured skin / outfit, recolours, patterns).
 */
export function sourcePart(m: SrcMesh, keepTri: Uint8Array | null, style: (i: number) => Style): Part | null {
  const n = m.pos.length / 3;
  const used = new Int32Array(n).fill(-1);
  const w = new PartWriter();
  const p = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const col = new THREE.Color();
  const tris = m.index.length / 3;
  const idx: number[] = [];
  for (let k = 0; k < tris; k++) {
    if (keepTri && !keepTri[k]) continue;
    for (let e = 0; e < 3; e++) {
      const i = m.index[k * 3 + e];
      if (used[i] < 0) {
        used[i] = w.count;
        p.fromArray(m.pos, i * 3);
        nn.fromArray(m.nor, i * 3);
        if (m.col) col.fromArray(m.col, i * 3);
        w.vertex(p, nn, m.uv[i * 2], m.uv[i * 2 + 1], style(i), m, i, undefined, m.col ? col : undefined);
      }
      idx.push(used[i]);
    }
  }
  if (!idx.length) return null;
  for (let k = 0; k < idx.length; k += 3) w.tri(idx[k], idx[k + 1], idx[k + 2]);
  return w.part();
}

/** Concatenate parts into one skinned geometry. */
export function assemble(parts: Part[]): THREE.BufferGeometry {
  let vc = 0;
  let ic = 0;
  for (const p of parts) {
    vc += p.pos.length / 3;
    ic += p.index.length;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const col = new Float32Array(vc * 3);
  const fx = new Float32Array(vc * 4);
  const si = new Uint16Array(vc * 4);
  const sw = new Float32Array(vc * 4);
  const index = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    nor.set(p.nor, vo * 3);
    uv.set(p.uv, vo * 2);
    col.set(p.col, vo * 3);
    fx.set(p.fx, vo * 4);
    si.set(p.si, vo * 4);
    sw.set(p.sw, vo * 4);
    for (let k = 0; k < p.index.length; k++) index[io + k] = p.index[k] + vo;
    io += p.index.length;
    vo += p.pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
