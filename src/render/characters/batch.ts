/**
 * Draw-call friendly version of the character models: every mesh of a model is baked (world
 * transform, flat/smooth normals, per-vertex colour) and merged into at most four meshes, one per
 * "material class":
 *   matte  - cloth, leather, fur, skin, wood            (MeshStandardMaterial, vertex colours)
 *   metal  - steel, gold                                (MeshStandardMaterial, vertex colours)
 *   glow   - self-lit gems, blades, eyes                (MeshBasicMaterial, vertex colours)
 *   aura   - additive halos / ground rings (subtle)     (MeshBasicMaterial, additive)
 * The result can be cloned per piece (`Group.clone()` shares geometry and materials).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCharacterModel, type CharacterModelOptions } from './index';

export interface BatchMaterials {
  matte: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  aura: THREE.MeshBasicMaterial;
}

/** Creates the four shared materials. `decorate` may add e.g. a rim light to the standard ones. */
export function createBatchMaterials(decorate?: (m: THREE.MeshStandardMaterial) => void): BatchMaterials {
  const matte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0 });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.55 });
  decorate?.(matte);
  decorate?.(metal);
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const aura = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { matte, metal, glow, aura };
}

export function disposeBatchMaterials(m: BatchMaterials): void {
  m.matte.dispose();
  m.metal.dispose();
  m.glow.dispose();
  m.aura.dispose();
}

type Klass = keyof BatchMaterials;

function classify(mat: THREE.Material): { klass: Klass; color: THREE.Color; flat: boolean } {
  if (mat instanceof THREE.MeshBasicMaterial) {
    // additive aura materials: colour * opacity, because additive blending makes that the intensity
    return { klass: 'aura', color: mat.color.clone().multiplyScalar(mat.opacity), flat: false };
  }
  const s = mat as THREE.MeshStandardMaterial;
  if (s.emissiveIntensity >= 1 && (s.emissive.r > 0 || s.emissive.g > 0 || s.emissive.b > 0)) {
    return { klass: 'glow', color: s.emissive.clone().multiplyScalar(Math.min(1.15, s.emissiveIntensity)), flat: false };
  }
  return { klass: s.metalness > 0.3 ? 'metal' : 'matte', color: s.color.clone(), flat: s.flatShading };
}

/**
 * Builds a character and merges it into <= 4 meshes. `auraStrength` scales the additive glow
 * (0 removes it). The model's own rarity ring is dropped (the board puck has one).
 */
export function buildBatchedCharacterModel(
  opts: CharacterModelOptions,
  mats: BatchMaterials,
  auraStrength = 0.45,
): THREE.Group {
  const src = buildCharacterModel(opts);
  const ring = src.getObjectByName('rarity-ring');
  ring?.parent?.remove(ring);
  src.updateMatrixWorld(true);

  const buckets: Record<Klass, THREE.BufferGeometry[]> = { matte: [], metal: [], glow: [], aura: [] };
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const { klass, color, flat } = classify(mesh.material as THREE.Material);
    if (klass === 'aura') color.multiplyScalar(auraStrength);
    if (klass === 'aura' && auraStrength <= 0) return;
    let geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geo.deleteAttribute('uv');
    geo.applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0) geo = flipWinding(geo);
    if (flat) geo.computeVertexNormals(); // non-indexed => per-face (flat) normals
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    buckets[klass].push(geo);
  });

  const out = new THREE.Group();
  out.name = src.name;
  out.userData = { ...src.userData };
  const head = src.getObjectByName('head');
  if (head) out.add(head.clone());
  (Object.keys(buckets) as Klass[]).forEach((k) => {
    const list = buckets[k];
    if (!list.length) return;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) return;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, mats[k]);
    m.name = `batch-${k}`;
    m.castShadow = k !== 'aura';
    if (k === 'aura') m.renderOrder = 2;
    out.add(m);
  });
  // The source meshes are throw-away; geometries/materials of the source live in the kit cache.
  return out;
}

function flipWinding(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.attributes[name] as THREE.BufferAttribute;
    const size = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let t = 0; t < attr.count; t += 3) {
      for (let k = 0; k < size; k++) {
        const a = (t + 1) * size + k;
        const b = (t + 2) * size + k;
        const tmp = arr[a];
        arr[a] = arr[b];
        arr[b] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
  return geo;
}
