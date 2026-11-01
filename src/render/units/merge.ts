/**
 * Merge a glTF character (several skinned body parts + rigid props parented to bones) into ONE
 * skinned geometry bound to the original skeleton: one draw call (+ one shadow draw) per unit.
 *
 * Skinning maths (three, AttachedBindMode, merged mesh bound with an identity bind matrix):
 *   world = sum_i w_i * bone_i.matrixWorld * boneInverse_i * v
 * - skinned part m (own inverse binds I_m, e.g. per-mesh quantization folded into them):
 *     world = sum w * bone.mw * I_m[j] * m.bindMatrix * v  ->  v' = I_s[j]^-1 * I_m[j] * m.bindMatrix * v
 *     (j = the vertex's main joint; exact when I_m and I_s differ by one mesh-wide transform)
 * - rigid prop p under bone b (index j): world = b.mw * L * v, L = b.mw^-1 * p.mw
 *                                        ->  v' = boneInverse_j^-1 * L * v  (weight 1 on j)
 * Quantized (normalized) attributes are read through getX/Y/Z, so the result is plain float data.
 */
import * as THREE from 'three';

export interface MergePart {
  mesh: THREE.Mesh;
  /** Emissive strength written to the per-vertex `aGlow` attribute. */
  glow: number;
  /** Rigid parts: the bone to attach to (defaults to the nearest skeleton ancestor). */
  bone?: THREE.Bone;
  /** Optional per-vertex colour override (vertex-coloured models). Receives the vertex index. */
  color?: (i: number, out: THREE.Color) => void;
  /** Optional per-vertex glow override. */
  glowAt?: (i: number) => number;
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpL = new THREE.Matrix4();
const tmpNM = new THREE.Matrix3();
const tmpC = new THREE.Color();

function nearestBone(o: THREE.Object3D, skeleton: THREE.Skeleton): number {
  let p: THREE.Object3D | null = o.parent;
  while (p) {
    const i = skeleton.bones.indexOf(p as THREE.Bone);
    if (i >= 0) return i;
    p = p.parent;
  }
  return 0;
}

/**
 * Build the merged geometry. All matrices must be up to date (call root.updateMatrixWorld(true)).
 * Attributes: position, normal, uv (if every part has one), color (if `withColor`), skinIndex,
 * skinWeight, aGlow.
 */
export function mergeSkinned(skeleton: THREE.Skeleton, parts: MergePart[], withColor: boolean): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  let withUv = true;
  for (const p of parts) {
    const g = p.mesh.geometry;
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
    if (!g.attributes.uv) withUv = false;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = withUv ? new Float32Array(vCount * 2) : null;
  const col = withColor ? new Float32Array(vCount * 3) : null;
  const si = new Uint16Array(vCount * 4);
  const sw = new Float32Array(vCount * 4);
  const glow = new Float32Array(vCount);
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);

  let vo = 0;
  let io = 0;
  for (const part of parts) {
    const mesh = part.mesh;
    const g = mesh.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const UV = g.attributes.uv;
    const C = g.attributes.color;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
    let joint = 0;
    // Skinned parts: per-joint correction matrices from the part's skeleton to the shared one.
    let perJoint: (THREE.Matrix4 | undefined)[] | null = null;
    let perJointN: (THREE.Matrix3 | undefined)[] | null = null;
    const own = (mesh as THREE.SkinnedMesh).skeleton;
    if (skinned) {
      tmpM.copy((mesh as THREE.SkinnedMesh).bindMatrix);
      if (own && own !== skeleton) {
        perJoint = [];
        perJointN = [];
      }
    } else {
      joint = part.bone ? Math.max(0, skeleton.bones.indexOf(part.bone)) : nearestBone(mesh, skeleton);
      const bone = skeleton.bones[joint];
      tmpL.copy(bone.matrixWorld).invert().multiply(mesh.matrixWorld);
      tmpM.copy(skeleton.boneInverses[joint]).invert().multiply(tmpL);
    }
    tmpNM.getNormalMatrix(tmpM);
    const SI = g.attributes.skinIndex;
    const SW = g.attributes.skinWeight;
    for (let i = 0; i < P.count; i++) {
      const o = vo + i;
      let vm = tmpM;
      let nm = tmpNM;
      if (perJoint && perJointN && SI && SW) {
        // Main joint of this vertex.
        let j = SI.getComponent(i, 0);
        let best = SW.getComponent(i, 0);
        for (let k = 1; k < 4; k++) {
          const w = SW.getComponent(i, k);
          if (w > best) {
            best = w;
            j = SI.getComponent(i, k);
          }
        }
        let m = perJoint[j];
        if (!m) {
          m = new THREE.Matrix4()
            .copy(skeleton.boneInverses[j])
            .invert()
            .multiply(own.boneInverses[j])
            .multiply((mesh as THREE.SkinnedMesh).bindMatrix);
          perJoint[j] = m;
          perJointN[j] = new THREE.Matrix3().getNormalMatrix(m);
        }
        vm = m;
        nm = perJointN[j] as THREE.Matrix3;
      }
      tmpV.fromBufferAttribute(P, i).applyMatrix4(vm);
      pos[o * 3] = tmpV.x;
      pos[o * 3 + 1] = tmpV.y;
      pos[o * 3 + 2] = tmpV.z;
      if (N) {
        tmpN.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        nor[o * 3] = tmpN.x;
        nor[o * 3 + 1] = tmpN.y;
        nor[o * 3 + 2] = tmpN.z;
      }
      if (uv && UV) {
        uv[o * 2] = UV.getX(i);
        uv[o * 2 + 1] = UV.getY(i);
      }
      if (col) {
        if (C) tmpC.setRGB(C.getX(i), C.getY(i), C.getZ(i));
        else tmpC.setRGB(1, 1, 1);
        part.color?.(i, tmpC);
        col[o * 3] = tmpC.r;
        col[o * 3 + 1] = tmpC.g;
        col[o * 3 + 2] = tmpC.b;
      }
      if (skinned && SI && SW) {
        for (let k = 0; k < 4; k++) {
          si[o * 4 + k] = SI.getComponent(i, k);
          sw[o * 4 + k] = SW.getComponent(i, k);
        }
      } else {
        si[o * 4] = joint;
        sw[o * 4] = 1;
      }
      glow[o] = part.glowAt ? part.glowAt(i) : part.glow;
    }
    if (g.index) {
      for (let k = 0; k < g.index.count; k++) index[io + k] = g.index.getX(k) + vo;
      io += g.index.count;
    } else {
      for (let k = 0; k < P.count; k++) index[io + k] = k + vo;
      io += P.count;
    }
    vo += P.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Replace faceted normals by averaged ones for vertices sharing a position (stylised smooth look). */
export function smoothNormals(geometry: THREE.BufferGeometry): void {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const sums = new Map<string, number[]>();
  const keys: string[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
    keys[i] = k;
    let s = sums.get(k);
    if (!s) {
      s = [0, 0, 0];
      sums.set(k, s);
    }
    s[0] += nor.getX(i);
    s[1] += nor.getY(i);
    s[2] += nor.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i]) as number[];
    tmpN.set(s[0], s[1], s[2]);
    if (tmpN.lengthSq() < 1e-10) continue;
    tmpN.normalize();
    nor.setXYZ(i, tmpN.x, tmpN.y, tmpN.z);
  }
  nor.needsUpdate = true;
}
