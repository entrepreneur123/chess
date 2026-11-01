/**
 * Per-BoardView unit factory: turns the cached glTF assets into merged, team-tinted, per-level
 * templates (one skinned draw call each) and spawns animated UnitActors from them.
 *
 * Ownership: every GPU resource created here (merged geometries, materials, canvas textures, FX)
 * is tracked and freed by dispose(). The parsed glTF data in assets.ts is never uploaded itself.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { CharacterId, Level, Piece, PlayerId } from '../../engine/types';
import { TEAM_COLORS } from '../palette';
import { UnitActor } from './actor';
import type { UnitAssets } from './assets';
import { LOOKS, type AtlasRect, type CharacterLook, type LevelLook } from './config';
import { makeHaloTexture, makePlumeGeometry, makeSparkGeometry, makeSparkMaterial, unitTime } from './fx';
import { mergeSkinned, smoothNormals, type MergePart } from './merge';

interface Template {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
}

interface GeoEntry {
  geometry: THREE.BufferGeometry;
  /** Scale that maps the merged (rest-pose) model to its board size. */
  scale: number;
  /** Model-space offset that centres the footprint on the origin. */
  offset: THREE.Vector3;
  height: number;
}

/**
 * Rest-pose world bounds of a merged skinned geometry. Merged vertices live in "skin space"
 * (quantization is folded into the inverse bind matrices), so bounds must be skinned on the CPU.
 */
function restBox(geometry: THREE.BufferGeometry, skel: THREE.Skeleton): THREE.Box3 {
  const tmp = new THREE.SkinnedMesh(geometry);
  tmp.bind(skel, new THREE.Matrix4());
  tmp.computeBoundingBox();
  const box = (tmp.boundingBox ?? new THREE.Box3()).clone();
  return box;
}

const lin = (hex: string): THREE.Color => new THREE.Color(hex); // Color(hex) converts sRGB -> linear

/** Unit material: standard PBR + team rim light + per-vertex pulsing glow (`aGlow`). */
function makeUnitMaterial(opts: {
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  rim: string;
  rimStrength: number;
  glowColor: string;
  glowPulse: boolean;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: opts.map ?? null,
    vertexColors: !!opts.vertexColors,
    roughness: 0.62,
    metalness: 0.0,
  });
  const rim = new THREE.Color(opts.rim);
  const glowColor = new THREE.Color(opts.glowColor);
  const pulse = opts.glowPulse ? 1 : 0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uGlowColor = { value: glowColor };
    shader.uniforms.uTime = unitTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRim;\nuniform vec3 uGlowColor;\nuniform float uTime;\nvarying float vGlow;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += uRim * fres * ${opts.rimStrength.toFixed(2)};
        float gp = ${pulse ? '0.8 + 0.2 * sin(uTime * 4.2)' : '1.0'};
        totalEmissiveRadiance += (diffuseColor.rgb * 0.9 + uGlowColor * 0.45) * vGlow * gp;`,
      );
  };
  mat.customProgramCacheKey = () => `unit-${opts.vertexColors ? 'vc' : 'map'}-${pulse}-${opts.rimStrength.toFixed(2)}`;
  return mat;
}

/** Linear-ish luminance of an 8-bit sRGB pixel (0..1). */
const lum = (r: number, g: number, b: number): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

function rampColor(t: number, dark: THREE.Color, mid: THREE.Color, light: THREE.Color, out: number[]): void {
  // Colours here are sRGB 0..1 (canvas space).
  let r: number;
  let g: number;
  let b: number;
  if (t <= 1) {
    r = dark.r + (mid.r - dark.r) * t;
    g = dark.g + (mid.g - dark.g) * t;
    b = dark.b + (mid.b - dark.b) * t;
  } else {
    const k = Math.min(1, (t - 1) * 1.6);
    r = mid.r + (light.r - mid.r) * k;
    g = mid.g + (light.g - mid.g) * k;
    b = mid.b + (light.b - mid.b) * k;
  }
  out[0] = Math.round(r * 255);
  out[1] = Math.round(g * 255);
  out[2] = Math.round(b * 255);
}

const srgb = (hex: string): THREE.Color => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).convertLinearToSRGB();

/**
 * Re-tint a KayKit palette atlas: team cells -> team ramp, optionally neutral metal -> gold/dark.
 * Returns a new CanvasTexture (or null if the image cannot be read, e.g. no 2D canvas).
 */
function tintAtlas(src: THREE.Texture, look: CharacterLook, owner: PlayerId, metal: LevelLook['metal']): THREE.Texture | null {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const W = c.width;
  const H = c.height;
  const rect = (r: AtlasRect): [number, number, number, number] => [
    Math.round(r[0] * W),
    Math.round(r[1] * H),
    Math.round(r[2] * W),
    Math.round(r[3] * H),
  ];
  const out = [0, 0, 0];

  if (metal && look.metalRegion) {
    const [x0, y0, x1, y1] = rect(look.metalRegion);
    const ramp =
      metal === 'gold'
        ? [srgb('#6E4210'), srgb('#E3A72F'), srgb('#FFF1B8')]
        : [srgb('#17142A'), srgb('#3E3466'), srgb('#9C8FD6')];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        const r = px[o];
        const g = px[o + 1];
        const b = px[o + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const l = lum(r, g, b);
        if (mx - mn > 26 || l < 0.14 || l > 0.86) continue; // only neutral greys
        rampColor(l / 0.5, ramp[0], ramp[1], ramp[2], out);
        px[o] = out[0];
        px[o + 1] = out[1];
        px[o + 2] = out[2];
      }
    }
  }

  const team = TEAM_COLORS[owner];
  const tDark = srgb(team.dark);
  const tMid = srgb(team.main);
  const tLight = srgb(team.light);
  for (const cr of look.teamCells) {
    const [x0, y0, x1, y1] = rect(cr);
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        sum += lum(px[o], px[o + 1], px[o + 2]);
        n++;
      }
    }
    const mean = Math.max(0.05, sum / Math.max(1, n));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        rampColor(lum(px[o], px[o + 1], px[o + 2]) / mean, tDark, tMid, tLight, out);
        px[o] = out[0];
        px[o + 1] = out[1];
        px[o + 2] = out[2];
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = src.flipY;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 2;
  return tex;
}

export class UnitLibrary {
  private readonly assets: UnitAssets;
  private readonly templates = new Map<string, Template>();
  private readonly geos = new Map<string, GeoEntry>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly auraMats: THREE.MeshBasicMaterial[] = [];
  private haloTex: THREE.Texture | null = null;
  private readonly glowTex: THREE.Texture;
  private spawnCount = 0;

  constructor(assets: UnitAssets, glowTex: THREE.Texture) {
    this.assets = assets;
    this.glowTex = glowTex;
  }

  /** Create an animated actor for a piece (facing +z; the caller sets the yaw). */
  createActor(p: Piece): UnitActor {
    const tpl = this.template(p.character, p.level, p.owner);
    const model = cloneSkinned(tpl.root) as THREE.Object3D;
    // Units are always on screen and their limbs leave the rest-pose bounds: skip culling.
    model.traverse((o) => {
      o.frustumCulled = false;
    });
    const phase = ((this.spawnCount++ * 0.37) % 1 + 1) % 1;
    return new UnitActor(model, tpl.clips, tpl.height, phase);
  }

  /** Per-frame shared animation state (aura flicker). */
  update(timeSec: number): void {
    unitTime.value = timeSec;
    for (let i = 0; i < this.auraMats.length; i++) {
      this.auraMats[i].opacity = 0.5 + 0.18 * Math.sin(timeSec * 3.1 + i);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.templates.clear();
    this.geos.clear();
  }

  // ---------------------------------------------------------------- templates

  private template(ch: CharacterId, level: Level, owner: PlayerId): Template {
    const key = `${ch}:${level}:${owner}`;
    let t = this.templates.get(key);
    if (!t) {
      t = this.buildTemplate(ch, level, owner);
      this.templates.set(key, t);
    }
    return t;
  }

  private buildTemplate(ch: CharacterId, level: Level, owner: PlayerId): Template {
    const look = LOOKS[ch];
    const lv = look.levels[level];
    const gltf = this.assets[ch];
    const team = TEAM_COLORS[owner];

    // Fresh clone of the glTF scene: bones + original meshes (used only as merge input).
    const scene = cloneSkinned(gltf.scene) as THREE.Object3D;
    if (look.boneScale) {
      for (const [name, k] of Object.entries(look.boneScale)) scene.getObjectByName(name)?.scale.multiplyScalar(k);
    }
    scene.updateMatrixWorld(true);
    let skeleton: THREE.Skeleton | null = null;
    scene.traverse((o) => {
      if (!skeleton && (o as THREE.SkinnedMesh).isSkinnedMesh) skeleton = (o as THREE.SkinnedMesh).skeleton;
    });
    if (!skeleton) throw new Error(`unit ${ch}: no skinned mesh`);
    const skel: THREE.Skeleton = skeleton;

    const vertexColored = ch === 'marki';
    const geoKey = vertexColored ? `${ch}:${level}:${owner}` : `${ch}:${level}`;
    let entry = this.geos.get(geoKey);
    if (!entry) {
      entry = this.mergeModel(ch, gltf, scene, skel, look, lv, owner);
      this.geos.set(geoKey, entry);
    }

    // Material (team tinted).
    let mat: THREE.MeshStandardMaterial;
    if (vertexColored) {
      mat = makeUnitMaterial({ vertexColors: true, rim: team.light, rimStrength: look.rim, glowColor: lv.aura?.color ?? '#ffffff', glowPulse: level === 3 });
      mat.roughness = 0.7;
    } else {
      const src = this.findMap(gltf);
      const tinted = src ? tintAtlas(src, look, owner, lv.metal) : null;
      if (tinted) this.textures.push(tinted);
      mat = makeUnitMaterial({ map: tinted ?? src, rim: team.light, rimStrength: look.rim, glowColor: lv.aura?.color ?? '#ffffff', glowPulse: level === 3 });
    }
    this.materials.push(mat);

    // Replace the source meshes with the merged skinned mesh.
    const remove: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) remove.push(o);
    });
    for (const o of remove) o.removeFromParent();
    const merged = new THREE.SkinnedMesh(entry.geometry, mat);
    merged.name = `unit-${ch}`;
    merged.castShadow = true;
    merged.receiveShadow = false;
    scene.add(merged);
    merged.bind(skel, new THREE.Matrix4());

    const holder = new THREE.Group();
    holder.name = `tpl-${ch}-lv${level}-p${owner}`;
    const st = look.stretch ?? [1, 1, 1];
    scene.scale.set(entry.scale * st[0], entry.scale * st[1], entry.scale * st[2]);
    scene.position.copy(entry.offset).multiplyScalar(entry.scale);
    holder.add(scene);

    if (lv.halo) this.addHalo(scene, skel, entry);
    if (lv.aura) this.addAura(holder, lv.aura, level, entry.height);

    return { root: holder, clips: gltf.animations, height: entry.height };
  }

  private findMap(gltf: GLTF): THREE.Texture | null {
    let map: THREE.Texture | null = null;
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!map && m && m.map) map = m.map;
    });
    return map;
  }

  private mergeModel(
    ch: CharacterId,
    gltf: GLTF,
    scene: THREE.Object3D,
    skel: THREE.Skeleton,
    look: CharacterLook,
    lv: LevelLook,
    owner: PlayerId,
  ): GeoEntry {
    const parts: MergePart[] = [];
    const glow = lv.glow ?? {};
    const partNames = (gltf.scene.userData.parts as string[] | undefined) ?? [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
      if (!skinned && !lv.props.includes(mesh.name)) return;
      const part: MergePart = { mesh, glow: glow[mesh.name] ?? 0 };
      if (ch === 'marki') this.bullColors(part, partNames, lv, owner);
      parts.push(part);
    });

    if (lv.plume) {
      const plume = this.plumePart(scene, skel, look, lv.plume);
      if (plume) parts.push(plume);
    }

    const geometry = mergeSkinned(skel, parts, ch === 'marki');
    if (look.smooth) smoothNormals(geometry);
    for (const p of parts) if (p.mesh.userData.generated) p.mesh.geometry.dispose();
    this.geometries.push(geometry);
    const bb = restBox(geometry, skel);
    const h = Math.max(0.01, bb.max.y - Math.min(0, bb.min.y));
    const len = Math.max(0.01, bb.max.z - bb.min.z);
    // Height is normalised per character at Lv1 so upgrades (bigger props) do not shrink the body.
    let s = look.height / this.restHeight(ch, scene, skel);
    if (look.maxLength) s = Math.min(s, look.maxLength / len);
    s *= lv.scale;
    const offset = new THREE.Vector3(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
    if (ch !== 'marki') offset.set(0, 0, 0); // humanoids are authored centred on their feet
    offset.y = -bb.min.y * (ch === 'marki' ? 1 : 0);
    return { geometry, scale: s, offset, height: h * s };
  }

  private readonly restHeights = new Map<CharacterId, number>();

  /** Height of the bare body (skinned parts only) in model units. */
  private restHeight(ch: CharacterId, scene: THREE.Object3D, skel: THREE.Skeleton): number {
    let h = this.restHeights.get(ch);
    if (h !== undefined) return h;
    const box = new THREE.Box3();
    const parts: MergePart[] = [];
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push({ mesh: o as THREE.Mesh, glow: 0 });
    });
    const g = mergeSkinned(skel, parts, false);
    box.copy(restBox(g, skel));
    g.dispose();
    h = Math.max(0.01, box.max.y - Math.min(0, box.min.y));
    this.restHeights.set(ch, h);
    return h;
  }

  /** Bull: recolour baked vertex colours per material slot (`_part`) and set per-slot glow. */
  private bullColors(part: MergePart, names: string[], lv: LevelLook, owner: PlayerId): void {
    const attr = part.mesh.geometry.getAttribute('_part') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const team = TEAM_COLORS[owner];
    const colors = new Map<number, THREE.Color>();
    const glows = new Map<number, number>();
    names.forEach((n, i) => {
      const spec = lv.parts?.[n];
      if (n === 'plate_team') colors.set(i, lin(team.main));
      if (spec?.color) colors.set(i, lin(spec.color === 'team' ? team.main : spec.color));
      if (spec?.glow) glows.set(i, spec.glow);
    });
    part.color = (i, out) => {
      const c = colors.get(attr.getX(i));
      if (c) out.copy(c);
    };
    part.glowAt = (i) => glows.get(attr.getX(i)) ?? part.glow;
  }

  /** Team plume on top of the helmet (paladin), skinned rigidly to the head bone. */
  private plumePart(scene: THREE.Object3D, skel: THREE.Skeleton, look: CharacterLook, size: number): MergePart | null {
    const helmet = scene.getObjectByName('Knight_Helmet') as THREE.Mesh | undefined;
    const head = skel.bones.find((b) => b.name === 'head');
    if (!helmet || !head || look.teamCells.length === 0) return null;
    helmet.geometry.computeBoundingBox();
    const box = (helmet.geometry.boundingBox ?? new THREE.Box3()).clone().applyMatrix4(helmet.matrixWorld);
    const hh = box.max.y - box.min.y;
    const root = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - hh * 0.06, (box.min.z + box.max.z) / 2);
    const cellRect = look.teamCells[0];
    const u = (cellRect[0] + cellRect[2]) / 2;
    const geo = makePlumeGeometry(root, hh * size, u, cellRect[1], cellRect[3]);
    const mesh = new THREE.Mesh(geo);
    mesh.userData.generated = true;
    mesh.updateMatrixWorld(true);
    return { mesh, glow: 0, bone: head };
  }

  private addHalo(scene: THREE.Object3D, skel: THREE.Skeleton, entry: GeoEntry): void {
    const head = skel.bones.find((b) => b.name === 'head');
    if (!head) return;
    if (!this.haloTex) {
      this.haloTex = makeHaloTexture();
      this.textures.push(this.haloTex);
    }
    const mat = new THREE.SpriteMaterial({
      map: this.haloTex,
      color: '#FFE08A',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.name = 'halo';
    // Above and slightly behind the head; sizes are in board units (undo the bone's world scale).
    scene.updateMatrixWorld(true);
    const ws = head.getWorldScale(new THREE.Vector3());
    sprite.scale.set(0.6 / ws.x, 0.6 / ws.y, 1);
    const want = new THREE.Vector3(0, entry.height * 0.93, -0.12);
    sprite.position.copy(head.worldToLocal(want));
    head.add(sprite);
  }

  private addAura(holder: THREE.Group, aura: NonNullable<LevelLook['aura']>, level: Level, height: number): void {
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      color: aura.color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials.push(glowMat);
    this.auraMats.push(glowMat);
    const planeGeo = new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2);
    this.geometries.push(planeGeo);
    const ground = new THREE.Mesh(planeGeo, glowMat);
    ground.position.y = 0.012;
    ground.renderOrder = 2;
    holder.add(ground);

    const sparkGeo = makeSparkGeometry(aura.count, level * 7 + aura.count);
    const sparkMat = makeSparkMaterial(aura.color, aura.core);
    this.geometries.push(sparkGeo);
    this.materials.push(sparkMat);
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.scale.set(1, Math.max(0.7, height / 1.1), 1);
    sparks.renderOrder = 6;
    holder.add(sparks);
  }
}
