/**
 * Per-BoardView unit factory: turns the cached glTF assets into per-level templates (one skinned
 * draw call each: textured body + armour shells + procedural gear) and spawns animated UnitActors.
 *
 * Template build (once per character x level, cached; the team variant only swaps the material):
 *  1. clone the body scene (bones), apply the character's bone scales;
 *  2. run the character's outfit builder (outfits/*.ts): hides covered body triangles, adds armour
 *     shells (body regions pushed out, same skin weights), procedural gear and secondary bones;
 *  3. assemble everything into ONE skinned geometry (body texture + flat / team / glowing styles);
 *  4. per team: material (team tones are uniforms, the geometry is shared) and level FX: idle
 *     particles (Lv2+), ground rune + light shaft (Lv3).
 * Clips come from anims.glb, retargeted by bone name (rotations + pelvis translation scaled to the
 * body), trimmed / chained per character (config.ts ClipSpec).
 *
 * Ownership: every GPU resource created here (geometries, materials, textures) is tracked and freed
 * by dispose(). The parsed glTF data in assets.ts is never uploaded itself (its two body textures
 * are uploaded through the unit materials and released on dispose; a later view re-uploads them).
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterId, Level, Piece, PlayerId } from '../../engine/types';
import { TEAM_COLORS } from '../palette';
import { UnitActor } from './actor';
import type { UnitAssets } from './assets';
import { BodySource, assemble, buildShell, sourcePart, triMask, vertexMask, type Part } from './body';
import { LOOKS, type ClipName, type ClipSpec } from './config';
import { makeAuraGeometry, makeAuraMaterial, makeParticleGeometry, makeParticleMaterial, makeRuneTexture } from './fx';
import { GearBuilder, mixHex } from './gear';
import type { OutfitCtx, SecondarySpec } from './kit';
import { makeUnitMaterial, type DissolveUniforms, type UnitMaterialOptions, type UnitUniforms } from './material';
import { buildOutfit } from './outfits';
import type { Style } from './style';

/** Team-independent part of a template. */
interface Base {
  root: THREE.Group;
  geometry: THREE.BufferGeometry;
  height: number;
  secondary: SecondarySpec[];
  triangles: number;
  patScale: number;
  map: THREE.Texture | null;
  teamKey: number;
}

interface Template {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
  secondary: SecondarySpec[];
  idleSpeed: number;
  bob: number;
  material: THREE.MeshStandardMaterial;
  opts: UnitMaterialOptions;
  /** Dissolve variants: capture death (team-coloured edge) and storm removal (magenta edge). */
  dying: Record<DissolveKind, { material: THREE.MeshStandardMaterial; uniforms: DissolveUniforms } | null>;
  triangles: number;
}

export type DissolveKind = 'capture' | 'storm';
/** Hot edge colour of the storm dissolve (matches storm.ts STORM_COLORS.edge). */
const STORM_EDGE = '#FF3DF0';

const sources = new WeakMap<object, BodySource>();
/**
 * Team-independent bases, shared by every library (view) of the same loaded assets: built once per
 * session. Their geometry keeps its CPU arrays when a view disposes it, so a later view re-uploads
 * instead of rebuilding.
 */
const baseCache = new WeakMap<object, Map<string, Base>>();

/** Rest-pose world bounds of a skinned geometry bound to `skel` (bones at rest). */
function restBox(geometry: THREE.BufferGeometry, skel: THREE.Skeleton): THREE.Box3 {
  const tmp = new THREE.SkinnedMesh(geometry);
  tmp.bind(skel, new THREE.Matrix4());
  tmp.computeBoundingBox();
  return (tmp.boundingBox ?? new THREE.Box3()).clone();
}

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

/** Team tones (main, light, dark, muted, deep) of a player. */
export function teamTones(owner: PlayerId): [string, string, string, string, string] {
  const t = TEAM_COLORS[owner];
  return [t.main, t.light, t.dark, mixHex(t.main, '#6E7078', 0.42), mixHex(t.dark, '#0A0A12', 0.35)];
}

export class UnitLibrary {
  /** Shared uniforms of every unit material / FX of this view. */
  readonly uniforms: UnitUniforms;
  private readonly assets: UnitAssets;
  private readonly bases: Map<string, Base>;
  private readonly templates = new Map<string, Template>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly clipCache = new Map<CharacterId, THREE.AnimationClip[]>();
  private runeTex: THREE.Texture | null = null;
  private spawnCount = 0;

  /** `pointScale` may be shared with the owner (drawing-buffer px per world unit at distance 1). */
  constructor(assets: UnitAssets, pointScale: { value: number } = { value: 600 }) {
    this.assets = assets;
    this.uniforms = { time: { value: 0 }, spawn: { value: 0 }, pointScale };
    let b = baseCache.get(assets);
    if (!b) {
      b = new Map();
      baseCache.set(assets, b);
    }
    this.bases = b;
  }

  /** Create an animated actor for a piece (facing +z; the caller sets the yaw). */
  createActor(p: Piece): UnitActor {
    const tpl = this.template(p.character, p.level, p.owner);
    const model = cloneSkinned(tpl.root) as THREE.Object3D;
    const fx: THREE.Object3D[] = [];
    // Units are always on screen and their limbs leave the rest-pose bounds: skip culling.
    model.traverse((o) => {
      o.frustumCulled = false;
      if (o.userData.unitFx) fx.push(o);
    });
    const phase = ((this.spawnCount++ * 0.37) % 1 + 1) % 1;
    return new UnitActor(model, tpl.clips, tpl.height, phase, {
      secondary: tpl.secondary,
      idleSpeed: tpl.idleSpeed,
      bob: tpl.bob,
      fx,
    });
  }

  /**
   * Dissolve material for a dying unit of this look (cached per template and kind; one capture
   * and one storm wave play at a time). Drive it with setDissolve(k, kind).
   */
  dyingMaterial(p: Piece, kind: DissolveKind = 'capture'): THREE.Material {
    const tpl = this.template(p.character, p.level, p.owner);
    let d = tpl.dying[kind];
    if (!d) {
      const edge = kind === 'storm' ? STORM_EDGE : TEAM_COLORS[p.owner].glow;
      const uniforms: DissolveUniforms = { dissolve: { value: 0 }, edge: { value: new THREE.Color(edge) } };
      const material = makeUnitMaterial(this.uniforms, { ...tpl.opts, dissolve: true }, uniforms);
      this.materials.push(material);
      d = { material, uniforms };
      tpl.dying[kind] = d;
    }
    d.uniforms.dissolve.value = 0;
    return d.material;
  }

  /** Dissolve progress (0..1) of every dying material of a kind. */
  setDissolve(k: number, kind: DissolveKind = 'capture'): void {
    for (const t of this.templates.values()) {
      const d = t.dying[kind];
      if (d) d.uniforms.dissolve.value = k;
    }
  }

  /** Triangles of a template's merged unit mesh (diagnostics). */
  triangles(p: Pick<Piece, 'character' | 'level' | 'owner'>): number {
    return this.template(p.character, p.level, p.owner).triangles;
  }

  /** Unit height on the board (tile units, idle rest pose incl. helmet / horns). */
  height(p: Pick<Piece, 'character' | 'level' | 'owner'>): number {
    return this.template(p.character, p.level, p.owner).height;
  }

  /** Per-frame shared animation state. */
  update(timeSec: number): void {
    this.uniforms.time.value = timeSec;
  }

  private disposed = false;

  dispose(): void {
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
    this.templates.clear();
    // Shared bases stay cached (CPU data); free this view's GPU copies of their geometry.
    for (const b of this.bases.values()) b.geometry.dispose();
  }

  /** True when the team-independent part of a look is built (createActor will be cheap). */
  isPrepared(ch: CharacterId, level: Level): boolean {
    return this.bases.has(`${ch}:${level}`);
  }

  /**
   * Build the looks of `pieces` (then, if `all`, every other look) one per macrotask, so no single
   * long task blocks the main thread. Resolves when the pieces' looks are ready.
   */
  prepare(pieces: Pick<Piece, 'character' | 'level'>[], all = true): Promise<void> {
    const order: [CharacterId, Level][] = [];
    const seen = new Set<string>();
    const push = (ch: CharacterId, level: Level): void => {
      const k = `${ch}:${level}`;
      if (seen.has(k) || this.bases.has(k)) return;
      seen.add(k);
      order.push([ch, level]);
    };
    for (const p of pieces) push(p.character, p.level);
    const first = order.length;
    if (all) for (const ch of Object.keys(LOOKS) as CharacterId[]) for (const l of [1, 2, 3] as Level[]) push(ch, l);
    return new Promise((resolve) => {
      let i = 0;
      const step = (): void => {
        if (this.disposed) return resolve();
        if (i >= first) resolve();
        if (i >= order.length) return;
        const [ch, level] = order[i++];
        try {
          this.base(ch, level);
        } catch (err) {
          console.warn('[render] unit look build failed:', err);
        }
        // Looks needed now: next macrotask; background warm-up: idle time only.
        const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
        if (i < first || !ric) setTimeout(step, 0);
        else ric(step, { timeout: 3000 });
      };
      step();
    });
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

  private source(body: 'hero' | 'imp'): BodySource {
    const gltf = this.assets[body];
    let s = sources.get(gltf);
    if (!s) {
      s = new BodySource(gltf);
      sources.set(gltf, s);
    }
    return s;
  }

  private buildTemplate(ch: CharacterId, level: Level, owner: PlayerId): Template {
    const look = LOOKS[ch];
    const lv = look.levels[level];
    const base = this.base(ch, level);
    const team = TEAM_COLORS[owner];
    const opts: UnitMaterialOptions = {
      rim: team.light,
      rimStrength: look.rim * (level === 3 ? 1.25 : 1),
      glowColor: lv.glow,
      pulse: level === 3,
      patternColor: lv.patternColor ?? lv.glow,
      team: teamTones(owner),
      eyeColor: lv.eye ?? '#000000',
      teamKey: base.teamKey,
      map: this.map(look.body),
      patScale: base.patScale,
    };
    const mat = makeUnitMaterial(this.uniforms, opts);
    this.materials.push(mat);
    const root = cloneSkinned(base.root) as THREE.Group;
    root.name = `tpl-${ch}-lv${level}-p${owner}`;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).material = mat;
    });
    this.addFx(root, ch, level, owner, base.height);
    return {
      root,
      clips: this.clips(ch),
      height: base.height,
      secondary: base.secondary,
      idleSpeed: lv.idleSpeed ?? 1,
      bob: lv.bob ?? 0,
      material: mat,
      opts,
      dying: { capture: null, storm: null },
      triangles: base.triangles,
    };
  }

  /** Team-independent template: rig + merged geometry. */
  private base(ch: CharacterId, level: Level): Base {
    const key = `${ch}:${level}`;
    const cached = this.bases.get(key);
    if (cached) return cached;
    const look = LOOKS[ch];
    const lv = look.levels[level];
    const gltf = this.assets[look.body];
    const src = this.source(look.body);

    // Fresh clone of the body scene: bones (+ original meshes, removed below).
    const scene = cloneSkinned(gltf.scene) as THREE.Object3D;
    for (const [name, k] of Object.entries(look.boneScale ?? {})) {
      const b = scene.getObjectByName(name);
      if (b) b.scale.multiply(tmpV.set(k[0], k[1], k[2]));
    }
    scene.updateMatrixWorld(true);
    const bones = src.bones.map((n) => {
      const b = scene.getObjectByName(n);
      if (!b || !(b as THREE.Bone).isBone) throw new Error(`unit ${ch}: bone ${n} missing`);
      return b as THREE.Bone;
    });
    const boneIdx = new Map(bones.map((b, i) => [b.name, i]));
    const inverses = src.bindInv.map((m) => m.clone());
    const skinM = bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inverses[j]));

    // Idle pose sample (world matrices of every bone), for pose-aware gear placement.
    const idleWorld = this.sampleIdle(ch, scene, bones);

    // Outfit.
    const gear = new GearBuilder();
    const secondary: SecondarySpec[] = [];
    const used = new Map<string, (i: number) => Style>();
    const hidden = new Map<string, Uint8Array>();
    const shells: Part[] = [];
    const keep = (mesh: string): Uint8Array => {
      let k = hidden.get(mesh);
      if (!k) {
        k = new Uint8Array(src.mesh(mesh).index.length / 3).fill(1);
        hidden.set(mesh, k);
      }
      return k;
    };
    const hide = (mesh: string, tris: Uint8Array): void => {
      const k = keep(mesh);
      for (let i = 0; i < tris.length; i++) if (tris[i]) k[i] = 0;
    };
    const boneOf = (name: string): number => {
      const i = boneIdx.get(name);
      if (i === undefined) throw new Error(`unit ${ch}: bone ${name} missing`);
      return i;
    };
    const ctx: OutfitCtx = {
      ch,
      level,
      look: lv,
      src,
      gear,
      secondary,
      bone: boneOf,
      at: (name) => new THREE.Vector3().setFromMatrixPosition(bones[boneOf(name)].matrixWorld),
      boneWorld: (name) => bones[boneOf(name)].matrixWorld.clone(),
      addBone: (name, parentName, at) => {
        const pi = boneOf(parentName);
        const parent = bones[pi];
        const b = new THREE.Bone();
        b.name = name;
        parent.add(b);
        parent.updateMatrixWorld(true);
        b.position.copy(parent.worldToLocal(at.clone()));
        parent.getWorldQuaternion(tmpQ);
        b.quaternion.copy(tmpQ.invert());
        b.updateMatrixWorld(true);
        // Keep skin space consistent: B_new * Binv_new = B_parent * Binv_parent.
        inverses.push(new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(skinM[pi]));
        skinM.push(skinM[pi].clone());
        bones.push(b);
        boneIdx.set(name, bones.length - 1);
        return bones.length - 1;
      },
      use: (mesh, style) => {
        used.set(mesh, style);
      },
      hide,
      shell: (mesh, spec, hideCovered = true) => {
        const p = buildShell(src.mesh(mesh), spec);
        if (p) shells.push(p);
        if (hideCovered) hide(mesh, spec.tris);
      },
      vmask: (mesh, pred) => vertexMask(src, src.mesh(mesh), pred),
      tris: (mesh, pred, need = 3) => triMask(src.mesh(mesh), vertexMask(src, src.mesh(mesh), pred), need),
      world: (mesh, i, out = new THREE.Vector3()) => {
        const m = src.mesh(mesh);
        const p = tmpV.fromArray(m.pos, i * 3);
        out.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = m.sw[i * 4 + k];
          if (w > 0) out.addScaledVector(p.clone().applyMatrix4(skinM[m.si[i * 4 + k]]), w);
        }
        return out;
      },
      srcMesh: (mesh) => src.mesh(mesh),
      texel: (u, v) => this.texel(look.body, u, v),
      idleToRest: (name) => {
        const i = boneOf(name);
        return bones[i].matrixWorld.clone().multiply(idleWorld[i].clone().invert());
      },
      rigid: (name) => boneOf(name),
      blend: (a, b, from, to) => {
        const ia = boneOf(a);
        const ib = boneOf(b);
        const d = to.clone().sub(from);
        const l2 = Math.max(1e-6, d.lengthSq());
        return (p) => ({ a: ia, b: ib, t: Math.max(0, Math.min(1, p.clone().sub(from).dot(d) / l2)) });
      },
    };
    const outfit = buildOutfit(ctx);

    // Assemble: kept source triangles, shells, gear.
    const parts: Part[] = [];
    for (const [mesh, style] of used) {
      const p = sourcePart(src.mesh(mesh), hidden.get(mesh) ?? null, style);
      if (p) parts.push(p);
    }
    parts.push(...shells);
    const gp = gear.build(skinM);
    if (gp) parts.push(gp);
    const geometry = assemble(parts);

    // Replace the source meshes with the merged skinned mesh.
    const remove: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) remove.push(o);
    });
    for (const o of remove) o.removeFromParent();
    const skel = new THREE.Skeleton(bones, inverses);
    const merged = new THREE.SkinnedMesh(geometry);
    merged.name = `unit-${ch}`;
    merged.castShadow = true;
    merged.receiveShadow = false;
    scene.add(merged);
    merged.bind(skel, new THREE.Matrix4());

    // Fit: the bare body height is normalised per character, then the level scale.
    const bodyH = this.bodyHeight(src);
    const s = (look.height / bodyH) * lv.scale;
    const bb = restBox(geometry, skel);
    const h = Math.max(0.01, bb.max.y - Math.min(0, bb.min.y));
    const holder = new THREE.Group();
    scene.scale.setScalar(s);
    scene.userData.restY = 0;
    holder.add(scene);
    const size = bb.getSize(new THREE.Vector3());
    const base: Base = {
      root: holder,
      geometry,
      height: Math.min(h, bodyH * 1.3) * s,
      secondary,
      triangles: (geometry.index?.count ?? 0) / 3,
      patScale: 2.4 / Math.max(1e-4, Math.max(size.x, size.y, size.z)),
      map: this.map(look.body),
      teamKey: outfit.teamKey ?? 0,
    };
    this.bases.set(key, base);
    return base;
  }

  private readonly pixels = new Map<string, { data: Uint8ClampedArray; w: number; h: number } | null>();

  /** CPU read of the body texture (build time only; cached per body). */
  private texel(body: 'hero' | 'imp', u: number, v: number): [number, number, number] | null {
    let px = this.pixels.get(body);
    if (px === undefined) {
      px = null;
      const img = this.map(body)?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
      if (img && img.width && typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = Math.min(512, img.width);
        c.height = Math.min(512, img.height);
        const g = c.getContext('2d', { willReadFrequently: true });
        if (g) {
          g.drawImage(img, 0, 0, c.width, c.height);
          px = { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
        }
      }
      this.pixels.set(body, px);
    }
    if (!px) return null;
    const x = Math.min(px.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * px.w)));
    const y = Math.min(px.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * px.h)));
    const o = (y * px.w + x) * 4;
    return [px.data[o] / 255, px.data[o + 1] / 255, px.data[o + 2] / 255];
  }

  /** World matrices of the bones in the idle clip (30% in); the rest pose is restored afterwards. */
  private sampleIdle(ch: CharacterId, scene: THREE.Object3D, bones: THREE.Bone[]): THREE.Matrix4[] {
    const idle = this.clips(ch).find((c) => c.name === 'idle');
    const saved = bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
    const mixer = new THREE.AnimationMixer(scene);
    if (idle) {
      mixer.clipAction(idle).play();
      mixer.setTime(idle.duration * 0.3);
    }
    scene.updateMatrixWorld(true);
    const out = bones.map((b) => b.matrixWorld.clone());
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
    bones.forEach((b, i) => {
      b.position.copy(saved[i][0]);
      b.quaternion.copy(saved[i][1]);
      b.scale.copy(saved[i][2]);
    });
    scene.updateMatrixWorld(true);
    return out;
  }

  private bodyHeight(src: BodySource): number {
    const m = src.mesh('Body');
    let top = 0;
    for (let i = 1; i < m.pos.length; i += 3) top = Math.max(top, m.pos[i]);
    return top;
  }

  /** The body texture (uploaded through the unit materials; tracked for disposal). */
  private map(body: 'hero' | 'imp'): THREE.Texture | null {
    let map: THREE.Texture | null = null;
    this.assets[body].scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!map && m && m.map) map = m.map;
    });
    const t = map as THREE.Texture | null;
    if (t) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (!this.textures.includes(t)) this.textures.push(t);
    }
    return t;
  }

  /** Logical clips of a character, retargeted to its body (pelvis height) and trimmed / chained. */
  private clips(ch: CharacterId): THREE.AnimationClip[] {
    let c = this.clipCache.get(ch);
    if (c) return c;
    const look = LOOKS[ch];
    const anims = this.assets.anims;
    const byName = new Map(anims.animations.map((a) => [a.name, a]));
    // Pelvis translation ratio: body pelvis height / mannequin pelvis height.
    const src = this.source(look.body);
    const animPelvis = new THREE.Vector3();
    anims.scene.updateMatrixWorld(true);
    anims.scene.getObjectByName('pelvis')?.getWorldPosition(animPelvis);
    const ratio = src.bonePos('pelvis').y / Math.max(0.01, animPelvis.y);
    const make = (spec: ClipSpec): THREE.AnimationClip => {
      const clip = byName.get(spec.src);
      if (!clip) throw new Error(`clip ${spec.src} missing`);
      let out = trimClip(clip, spec.from ?? 0, spec.to ?? clip.duration);
      if (spec.then) out = chainClips(out, make(spec.then));
      return out;
    };
    c = [];
    for (const [name, spec] of Object.entries(look.clips) as [ClipName, ClipSpec][]) {
      const clip = make(spec);
      clip.name = name;
      // Drop tracks of bones this body does not have (the imp has no pinkies).
      clip.tracks = clip.tracks.filter((t) => src.boneIndex.has(t.name.slice(0, t.name.lastIndexOf('.'))));
      for (const t of clip.tracks) {
        if (t.name === 'pelvis.position') for (let k = 0; k < t.values.length; k++) t.values[k] *= ratio;
      }
      c.push(clip);
    }
    this.clipCache.set(ch, c);
    return c;
  }

  private addFx(holder: THREE.Group, ch: CharacterId, level: Level, owner: PlayerId, height: number): void {
    const lv = LOOKS[ch].levels[level];
    const team = TEAM_COLORS[owner];
    if (lv.particles) {
      const geo = makeParticleGeometry(lv.particles.count, level * 7 + lv.particles.count + owner * 3 + ch.length);
      const mat = makeParticleMaterial(this.uniforms, lv.particles);
      this.geometries.push(geo);
      this.materials.push(mat);
      const pts = new THREE.Points(geo, mat);
      pts.scale.set(1, Math.max(0.7, height / 1.4), 1);
      pts.renderOrder = 6;
      pts.userData.unitFx = true;
      holder.add(pts);
    }
    if (lv.rune) {
      // Ground rune + light shaft: one additive draw.
      if (!this.runeTex) {
        this.runeTex = makeRuneTexture();
        this.textures.push(this.runeTex);
      }
      const mat = makeAuraMaterial(this.uniforms, this.runeTex, {
        rune: lv.rune.color,
        aura: lv.rune.aura,
        team: team.glow,
        shaft: lv.shaft?.color ?? lv.rune.color,
        opacity: lv.shaft?.opacity ?? 0,
      });
      const geo = makeAuraGeometry(Math.max(1.6, height * 1.25));
      this.geometries.push(geo);
      this.materials.push(mat);
      const aura = new THREE.Mesh(geo, mat);
      aura.renderOrder = 2;
      aura.userData.unitFx = true;
      aura.raycast = () => undefined;
      holder.add(aura);
    }
  }
}

// ---------------------------------------------------------------- clip helpers

/** Sub-range [from, to] of a clip (seconds), re-timed to start at 0; boundary keys interpolated. */
export function trimClip(clip: THREE.AnimationClip, from: number, to: number): THREE.AnimationClip {
  const tracks = clip.tracks.map((t) => {
    const size = t.getValueSize();
    const interp = (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
    const times: number[] = [];
    const values: number[] = [];
    const push = (time: number, v: ArrayLike<number>): void => {
      times.push(time - from);
      for (let k = 0; k < size; k++) values.push(v[k]);
    };
    push(from, Array.from(interp.evaluate(from)));
    for (let i = 0; i < t.times.length; i++) {
      const tt = t.times[i];
      if (tt > from + 1e-4 && tt < to - 1e-4) push(tt, t.values.subarray(i * size, i * size + size));
    }
    push(to, Array.from(interp.evaluate(to)));
    const Ctor = t.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new Ctor(t.name, times, values);
  });
  return new THREE.AnimationClip(clip.name, to - from, tracks);
}

/** `b` appended after `a` (tracks matched by name). */
export function chainClips(a: THREE.AnimationClip, b: THREE.AnimationClip): THREE.AnimationClip {
  const gap = 1 / 30;
  const bt = new Map(b.tracks.map((t) => [t.name, t]));
  const tracks = a.tracks.map((t) => {
    const u = bt.get(t.name);
    if (!u) return t.clone();
    const times = Array.from(t.times).concat(Array.from(u.times, (x) => x + a.duration + gap));
    const values = Array.from(t.values).concat(Array.from(u.values));
    const Ctor = t.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new Ctor(t.name, times, values);
  });
  return new THREE.AnimationClip(a.name, a.duration + gap + b.duration, tracks);
}
