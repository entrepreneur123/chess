/**
 * Loads the unit GLBs once per page (parallel, meshopt-compressed, WebP textures, decoder bundled
 * locally, GLTFLoader code-split into its own chunk) and caches the parsed glTF:
 *   hero.glb   heroic human body + outfit parts (sad, marki, walk)
 *   imp.glb    the imp body (insaner)
 *   anims.glb  the shared clips (one rig for every body)
 * The cache holds CPU-side data (+ the two textures): every BoardView builds its own merged GPU
 * geometry/materials from it (see library.ts) and disposes them with the view.
 */
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export interface UnitAssets {
  hero: GLTF;
  imp: GLTF;
  anims: GLTF;
}

const FILES: Record<keyof UnitAssets, string> = {
  hero: 'models/hero.glb',
  imp: 'models/imp.glb',
  anims: 'models/anims.glb',
};

let pending: Promise<UnitAssets> | null = null;
let loaded: UnitAssets | null = null;

/** Resolve a public/ asset relative to the document (works with Vite base './' and Capacitor). */
function assetUrl(path: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? './';
  return new URL(base.replace(/\/?$/, '/') + path, document.baseURI).href;
}

/** Start (or join) loading of all unit models. Rejects if any file fails; callers fall back. */
export function loadUnitAssets(): Promise<UnitAssets> {
  if (pending) return pending;
  const keys = Object.keys(FILES) as (keyof UnitAssets)[];
  // Loader + decoder are code-split: the board (with silhouettes) is interactive before they arrive.
  pending = Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])
    .then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return Promise.all(keys.map((k) => loader.loadAsync(assetUrl(FILES[k]))));
    })
    .then((list) => {
      const out = {} as UnitAssets;
      keys.forEach((k, i) => {
        out[k] = list[i];
      });
      loaded = out;
      return out;
    });
  // Allow a retry by a later view if this attempt failed (e.g. offline on first launch).
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

/** Already-parsed assets, if loading finished. */
export function unitAssetsIfLoaded(): UnitAssets | null {
  return loaded;
}
