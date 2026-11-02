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
 * - world-space gear (gear.ts): v' = boneInverse_j^-1 * bone_j.mw^-1 * v, j = the vertex's main joint
 * Quantized (normalized) attributes are read through getX/Y/Z, so the result is plain float data.
 */
import * as THREE from 'three';

export interface MergePart {
  mesh: THREE.Mesh;
  /** Rigid parts: the bone to attach to (defaults to the nearest skeleton ancestor). */
  bone?: THREE.Bone;
  /**
   * Gear authored in rest-pose WORLD space (scene root at identity): the geometry carries
   * `color`, `aFx`, `skinIndex` and `skinWeight` (indices into the shared skeleton).
   */
  world?: boolean;
  /** Per-vertex albedo (linear) and effect data (glow, metal, pattern, spare) for glTF parts. */
  vertex?: (i: number, color: THREE.Color, fx: THREE.Vector4) => void;
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpL = new THREE.Matrix4();
const tmpNM = new THREE.Matrix3();
const tmpC = new THREE.Color();
const tmpF = new THREE.Vector4();

function nearestBone(o: THREE.Object3D, skeleton: THREE.Skeleton): number {
  let p: THREE.Object3D | null = o.parent;
  while (p) {
    const i = skeleton.bones.indexOf(p as THREE.Bone);
    if (i >= 0) return i;
    p = p.parent;
  }
  return 0;
}

const tmpW = new THREE.Matrix4();

/**
 * World gear: the exact rest-pose inverse of linear blend skinning. With bone-scaled rigs the
 * per-joint skin transforms B_j * Binv_j differ, so v' = (sum_k w_k B_k Binv_k)^-1 * v_world.
 */
function worldToBindBlend(skeleton: THREE.Skeleton, SI: THREE.BufferAttribute, SW: THREE.BufferAttribute, i: number, skinM: (THREE.Matrix4 | undefined)[], out: THREE.Matrix4): THREE.Matrix4 {
  const e = out.elements;
  e.fill(0);
  for (let k = 0; k < 4; k++) {
    const w = SW.getComponent(i, k);
    if (w <= 0) continue;
    const j = SI.getComponent(i, k);
    let m = skinM[j];
    if (!m) {
      m = new THREE.Matrix4().multiplyMatrices(skeleton.bones[j].matrixWorld, skeleton.boneInverses[j]);
      skinM[j] = m;
    }
    const me = m.elements;
    for (let q = 0; q < 16; q++) e[q] += me[q] * w;
  }
  return out.invert();
}

/**
 * Build the merged geometry. All matrices must be up to date (call root.updateMatrixWorld(true)).
 * Attributes: position, normal, color, aFx, skinIndex, skinWeight.
 */
export function mergeSkinned(skeleton: THREE.Skeleton, parts: MergePart[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    const g = p.mesh.geometry;
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const fx = new Float32Array(vCount * 4);
  const si = new Uint16Array(vCount * 4);
  const sw = new Float32Array(vCount * 4);
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);

  let vo = 0;
  let io = 0;
  for (const part of parts) {
    const mesh = part.mesh;
    const g = mesh.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const C = g.attributes.color;
    const FX = g.attributes.aFx;
    const SI = g.attributes.skinIndex;
    const SW = g.attributes.skinWeight;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
    let joint = 0;
    // Per-joint correction matrices (skinned parts with their own skeleton, world gear).
    let perJoint: (THREE.Matrix4 | undefined)[] | null = null;
    let perJointN: (THREE.Matrix3 | undefined)[] | null = null;
    const own = (mesh as THREE.SkinnedMesh).skeleton;
    const skinM: (THREE.Matrix4 | undefined)[] = [];
    if (part.world) {
      // handled per vertex below
    } else if (skinned) {
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
    for (let i = 0; i < P.count; i++) {
      const o = vo + i;
      let vm = tmpM;
      let nm = tmpNM;
      if (part.world && SI && SW) {
        vm = worldToBindBlend(skeleton, SI as THREE.BufferAttribute, SW as THREE.BufferAttribute, i, skinM, tmpW);
        nm = tmpNM.getNormalMatrix(vm);
      } else if (perJoint && perJointN && SI && SW) {
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
      if (C) tmpC.setRGB(C.getX(i), C.getY(i), C.getZ(i));
      else tmpC.setRGB(1, 1, 1);
      if (FX) tmpF.fromBufferAttribute(FX as THREE.BufferAttribute, i);
      else tmpF.set(0, 0, 0, 0);
      part.vertex?.(i, tmpC, tmpF);
      col[o * 3] = tmpC.r;
      col[o * 3 + 1] = tmpC.g;
      col[o * 3 + 2] = tmpC.b;
      fx[o * 4] = tmpF.x;
      fx[o * 4 + 1] = tmpF.y;
      fx[o * 4 + 2] = tmpF.z;
      fx[o * 4 + 3] = tmpF.w;
      if ((skinned || part.world) && SI && SW) {
        for (let k = 0; k < 4; k++) {
          si[o * 4 + k] = SI.getComponent(i, k);
          sw[o * 4 + k] = SW.getComponent(i, k);
        }
      } else {
        si[o * 4] = joint;
        sw[o * 4] = 1;
      }
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
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Replace faceted normals by averaged ones for vertices sharing a position (stylised smooth look).
 * Only the first `count` vertices are touched (the organic body; hard-surface gear follows it).
 */
export function smoothNormals(geometry: THREE.BufferGeometry, count = Infinity): void {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const n = Math.min(count, pos.count);
  const sums = new Map<string, number[]>();
  const keys: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
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
  for (let i = 0; i < n; i++) {
    const s = sums.get(keys[i]) as number[];
    tmpN.set(s[0], s[1], s[2]);
    if (tmpN.lengthSq() < 1e-10) continue;
    tmpN.normalize();
    nor.setXYZ(i, tmpN.x, tmpN.y, tmpN.z);
  }
  nor.needsUpdate = true;
}
