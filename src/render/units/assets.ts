/**
 * Loads the three unit GLBs once per page (parallel, meshopt-compressed, decoder bundled locally,
 * GLTFLoader code-split into its own chunk)
 * and caches the parsed glTF. The cache holds CPU-side data only: every BoardView builds its own
 * merged GPU geometry/materials from it (see library.ts) and disposes them with the view.
 */
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { CharacterId } from '../../engine/types';
import { LOOKS } from './config';

export type UnitAssets = Record<CharacterId, GLTF>;

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
  const ids: CharacterId[] = ['sad', 'marki', 'walk'];
  // Loader + decoder are code-split: the board (with silhouettes) is interactive before they arrive.
  pending = Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])
    .then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return Promise.all(ids.map((id) => loader.loadAsync(assetUrl(LOOKS[id].file))));
    })
    .then((list) => {
      const out = { sad: list[0], marki: list[1], walk: list[2] } as UnitAssets;
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
