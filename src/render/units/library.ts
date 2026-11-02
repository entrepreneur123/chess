/**
 * Per-BoardView unit factory: turns the cached glTF assets into merged, team-tinted, per-level
 * templates (one skinned draw call each: body + glTF props + procedural gear) and spawns animated
 * UnitActors from them.
 *
 * Template build (once per character x level x team, cached):
 *  1. clone the glTF scene, stylise proportions (bone scales), scale props;
 *  2. measure the rest-pose body and build the procedural outfit (outfits.ts) incl. extra
 *     secondary-motion bones;
 *  3. bake the KayKit palette atlas (or the bull's slot colours) into vertex colours through the
 *     level palette (config.ts roles) -> no textures; glow/metal/pattern go to `aFx`;
 *  4. merge everything into one SkinnedMesh bound to the (extended) skeleton;
 *  5. add the level FX: idle particles (Lv2+), ground rune + light shaft (Lv3).
 *
 * Ownership: every GPU resource created here (geometries, materials, textures) is tracked and
 * freed by dispose(). The parsed glTF data in assets.ts is never uploaded itself.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { CharacterId, Level, Piece, PlayerId } from '../../engine/types';
import { TEAM_COLORS } from '../palette';
import { UnitActor } from './actor';
import type { UnitAssets } from './assets';
import { LOOKS, type CharacterLook, type LevelLook, type RoleStyle, type Tint } from './config';
import { makeAuraGeometry, makeAuraMaterial, makeParticleGeometry, makeParticleMaterial, makeRuneTexture } from './fx';
import { BodyCloud, GearBuilder, mixHex } from './gear';
import { makeUnitMaterial, type DissolveUniforms, type UnitUniforms } from './material';
import { mergeSkinned, smoothNormals, type MergePart } from './merge';
import { buildOutfit, type OutfitCtx, type SecondarySpec } from './outfits';

interface Template {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
  secondary: SecondarySpec[];
  idleSpeed: number;
  bob: number;
  material: THREE.MeshStandardMaterial;
  opts: Parameters<typeof makeUnitMaterial>[1];
  dying: { material: THREE.MeshStandardMaterial; uniforms: DissolveUniforms } | null;
  triangles: number;
}

/** CPU copy of a palette atlas + per-cell mean luminance (for shading-preserving recolour). */
interface Atlas {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  flipY: boolean;
  cellMean: Map<string, number>;
}

/**
 * Rest-pose world bounds of a merged skinned geometry. Merged vertices live in "skin space"
 * (quantization is folded into the inverse bind matrices), so bounds must be skinned on the CPU.
 */
function restBox(geometry: THREE.BufferGeometry, skel: THREE.Skeleton): THREE.Box3 {
  const tmp = new THREE.SkinnedMesh(geometry);
  tmp.bind(skel, new THREE.Matrix4());
  tmp.computeBoundingBox();
  return (tmp.boundingBox ?? new THREE.Box3()).clone();
}

/** Linear-ish luminance of 0..1 sRGB components. */
const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export class UnitLibrary {
  /** Shared uniforms of every unit material / FX of this view. */
  readonly uniforms: UnitUniforms;
  private readonly assets: UnitAssets;
  private readonly templates = new Map<string, Template>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly atlases = new Map<CharacterId, Atlas | null>();
  private readonly clipCache = new Map<CharacterId, THREE.AnimationClip[]>();
  private readonly restHeights = new Map<CharacterId, number>();
  private runeTex: THREE.Texture | null = null;
  private spawnCount = 0;

  /** `pointScale` may be shared with the owner (drawing-buffer px per world unit at distance 1). */
  constructor(assets: UnitAssets, pointScale: { value: number } = { value: 600 }) {
    this.assets = assets;
    this.uniforms = { time: { value: 0 }, spawn: { value: 0 }, pointScale };
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
   * Dissolve material for a dying unit of this look (cached per template; one capture plays at a
   * time). Drive it with setDissolve().
   */
  dyingMaterial(p: Piece): THREE.Material {
    const tpl = this.template(p.character, p.level, p.owner);
    if (!tpl.dying) {
      const uniforms: DissolveUniforms = { dissolve: { value: 0 }, edge: { value: new THREE.Color(TEAM_COLORS[p.owner].glow) } };
      const material = makeUnitMaterial(this.uniforms, { ...tpl.opts, dissolve: true }, uniforms);
      this.materials.push(material);
      tpl.dying = { material, uniforms };
    }
    tpl.dying.uniforms.dissolve.value = 0;
    return tpl.dying.material;
  }

  /** Dissolve progress (0..1) of every dying material. */
  setDissolve(k: number): void {
    for (const t of this.templates.values()) if (t.dying) t.dying.uniforms.dissolve.value = k;
  }

  /** Triangles of a template's merged unit mesh (diagnostics). */
  triangles(p: Pick<Piece, 'character' | 'level' | 'owner'>): number {
    return this.template(p.character, p.level, p.owner).triangles;
  }

  /** Per-frame shared animation state. */
  update(timeSec: number): void {
    this.uniforms.time.value = timeSec;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
    this.templates.clear();
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

  private tint(owner: PlayerId, t: Tint): string {
    const team = TEAM_COLORS[owner];
    switch (t) {
      case 'team':
        return team.main;
      case 'teamLight':
        return team.light;
      case 'teamDark':
        return team.dark;
      case 'teamMuted':
        return mixHex(team.main, '#6E7078', 0.42);
      case 'teamDeep':
        return mixHex(team.dark, '#0A0A12', 0.35);
      default:
        return t;
    }
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
    for (const [name, k] of Object.entries(lv.propScale ?? {})) scene.getObjectByName(name)?.scale.multiplyScalar(k);
    scene.updateMatrixWorld(true);
    let skeleton: THREE.Skeleton | null = null;
    const skinned: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      skinned.push(sm);
      if (!skeleton) skeleton = sm.skeleton;
    });
    if (!skeleton) throw new Error(`unit ${ch}: no skinned mesh`);
    const baseSkel: THREE.Skeleton = skeleton;
    const partNames = (gltf.scene.userData.parts as string[] | undefined) ?? [];

    // Rest-pose body measurement (tags: humanoid 0 body / 1 arms / 2 legs / 3 head; bull slot).
    const body = new BodyCloud();
    for (const sm of skinned) {
      const partAttr = sm.geometry.getAttribute('_part') as THREE.BufferAttribute | undefined;
      const tag = /Head/.test(sm.name) ? 3 : /Arm/.test(sm.name) ? 1 : /Leg/.test(sm.name) ? 2 : 0;
      body.addSkinned(sm, partAttr ? (i) => Math.round(partAttr.getX(i)) : () => tag);
    }

    // Procedural outfit (+ secondary bones).
    const gear = new GearBuilder();
    const extraBones: THREE.Bone[] = [];
    const extraInv = new Map<THREE.Bone, THREE.Matrix4>();
    const secondary: SecondarySpec[] = [];
    const bindOf = (b: THREE.Bone): THREE.Matrix4 | undefined => {
      const i = baseSkel.bones.indexOf(b);
      return i >= 0 ? baseSkel.boneInverses[i] : extraInv.get(b);
    };
    const ctx: OutfitCtx = {
      ch,
      level,
      owner,
      look: lv,
      scene,
      body,
      gear,
      secondary,
      tint: (t) => this.tint(owner, t),
      bone: (name) => {
        const b = scene.getObjectByName(name);
        if (!b || !(b as THREE.Bone).isBone) throw new Error(`unit ${ch}: bone ${name} missing`);
        return b as THREE.Bone;
      },
      addBone: (name, parent, at) => {
        const b = new THREE.Bone();
        b.name = name;
        parent.add(b);
        parent.updateMatrixWorld(true);
        b.position.copy(parent.worldToLocal(at.clone()));
        parent.getWorldQuaternion(tmpQ);
        b.quaternion.copy(tmpQ.invert());
        b.updateMatrixWorld(true);
        // Keep skin space consistent: B_new * Binv_new = B_parent * Binv_parent.
        const pInv = bindOf(parent) ?? new THREE.Matrix4();
        const m = new THREE.Matrix4().copy(parent.matrixWorld).multiply(pInv);
        extraInv.set(b, new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(m));
        extraBones.push(b);
        return b;
      },
    };
    buildOutfit(ctx);
    const skel =
      extraBones.length > 0
        ? new THREE.Skeleton(
            baseSkel.bones.concat(extraBones),
            baseSkel.boneInverses.concat(extraBones.map((b) => extraInv.get(b) as THREE.Matrix4)),
          )
        : baseSkel;

    // Merge body + props + gear with baked palette colours.
    const palette = this.resolvePalette(lv, owner);
    const atlas = ch === 'marki' ? null : this.atlas(ch, gltf);
    const parts: MergePart[] = [];
    let bodyVerts = 0;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const isSkinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
      if (!isSkinned && !lv.props.includes(mesh.name)) return;
      const part: MergePart = { mesh };
      if (ch === 'marki') this.bullVertex(part, look, partNames, palette);
      else if (atlas) this.atlasVertex(part, look, atlas, palette);
      if (isSkinned) {
        parts.unshift(part);
        bodyVerts += mesh.geometry.attributes.position.count;
      } else parts.push(part);
    });
    const gearMesh = gear.build(skel);
    if (gearMesh) parts.push({ mesh: gearMesh, world: true });
    const geometry = mergeSkinned(skel, parts);
    gearMesh?.geometry.dispose();
    if (look.smooth) smoothNormals(geometry, bodyVerts);
    this.geometries.push(geometry);

    // Fit: height normalised per character on the bare Lv1 body, then the level scale.
    const bb = restBox(geometry, skel);
    const len = Math.max(0.01, bb.max.z - bb.min.z);
    let s = look.height / this.restHeight(ch, skinned, baseSkel);
    if (look.maxLength) s = Math.min(s, look.maxLength / len);
    s *= lv.scale;
    const h = Math.max(0.01, bb.max.y - Math.min(0, bb.min.y));
    const bodyH = this.restHeights.get(ch) ?? h;
    const offset = new THREE.Vector3(0, 0, 0);
    if (ch === 'marki') offset.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);

    // Material (patterns normalised to a ~2.4-unit tall model).
    const opts = {
      rim: team.light,
      rimStrength: look.rim * (level === 3 ? 1.25 : 1),
      glowColor: lv.glow,
      pulse: level === 3,
      patternColor: lv.patternColor ?? lv.glow,
      patScale: 2.4 / Math.max(1e-4, geometry.boundingBox ? Math.max(...geometry.boundingBox.getSize(new THREE.Vector3()).toArray()) : 1),
    };
    const mat = makeUnitMaterial(this.uniforms, opts);
    mat.roughness = ch === 'marki' ? 0.72 : 0.62;
    this.materials.push(mat);

    // Replace the source meshes with the merged skinned mesh.
    const remove: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) remove.push(o);
    });
    for (const o of remove) o.removeFromParent();
    const merged = new THREE.SkinnedMesh(geometry, mat);
    merged.name = `unit-${ch}`;
    merged.castShadow = true;
    merged.receiveShadow = false;
    scene.add(merged);
    merged.bind(skel, new THREE.Matrix4());

    const holder = new THREE.Group();
    holder.name = `tpl-${ch}-lv${level}-p${owner}`;
    const st = look.stretch ?? [1, 1, 1];
    scene.scale.set(s * st[0], s * st[1], s * st[2]);
    scene.position.copy(offset).multiplyScalar(s);
    scene.userData.restY = scene.position.y;
    holder.add(scene);

    const unitH = Math.min(h, bodyH * 1.25) * s;
    this.addFx(holder, ch, lv, level, owner, unitH);

    return {
      root: holder,
      clips: this.clips(ch, gltf, look, baseSkel),
      height: unitH,
      secondary,
      idleSpeed: lv.idleSpeed ?? 1,
      bob: lv.bob ?? 0,
      material: mat,
      opts,
      dying: null,
      triangles: (geometry.index?.count ?? 0) / 3,
    };
  }

  /** Resolve team tints of a level palette to linear colours. */
  private resolvePalette(lv: LevelLook, owner: PlayerId): Map<string, { style: RoleStyle; color: THREE.Color }> {
    const out = new Map<string, { style: RoleStyle; color: THREE.Color }>();
    for (const [role, style] of Object.entries(lv.palette)) out.set(role, { style, color: new THREE.Color(this.tint(owner, style.color)) });
    return out;
  }

  /** CPU copy of the character's palette atlas (null if it cannot be read). */
  private atlas(ch: CharacterId, gltf: GLTF): Atlas | null {
    if (this.atlases.has(ch)) return this.atlases.get(ch) ?? null;
    let map: THREE.Texture | null = null;
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!map && m && m.map) map = m.map;
    });
    let atlas: Atlas | null = null;
    const tex = map as THREE.Texture | null;
    const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (tex && img && img.width) {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (g) {
        g.drawImage(img, 0, 0);
        const data = g.getImageData(0, 0, c.width, c.height).data;
        const [cols, rows] = LOOKS[ch].grid ?? [8, 4];
        const cellMean = new Map<string, number>();
        const cw = c.width / cols;
        const chh = c.height / rows;
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < cols; k++) {
            let sum = 0;
            let n = 0;
            for (let y = Math.floor(r * chh); y < Math.floor((r + 1) * chh); y++) {
              for (let x = Math.floor(k * cw); x < Math.floor(k * cw + cw * 0.75); x++) {
                const o = (y * c.width + x) * 4;
                sum += lum(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255);
                n++;
              }
            }
            cellMean.set(`${k},${r}`, Math.max(0.04, sum / Math.max(1, n)));
          }
        }
        atlas = { data, w: c.width, h: c.height, flipY: tex.flipY, cellMean };
      }
    }
    this.atlases.set(ch, atlas);
    return atlas;
  }

  /** Humanoids: sample the atlas at each vertex UV, remap by role through the level palette. */
  private atlasVertex(part: MergePart, look: CharacterLook, atlas: Atlas, palette: ReturnType<UnitLibrary['resolvePalette']>): void {
    const uv = part.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (!uv) return;
    const [cols, rows] = look.grid ?? [8, 4];
    part.vertex = (i, color, fx) => {
      const u = Math.min(0.9999, Math.max(0, uv.getX(i)));
      let v = Math.min(0.9999, Math.max(0, uv.getY(i)));
      if (atlas.flipY) v = 1 - v;
      const px = Math.floor(u * atlas.w);
      const py = Math.floor(v * atlas.h);
      const o = (py * atlas.w + px) * 4;
      const r = atlas.data[o] / 255;
      const g = atlas.data[o + 1] / 255;
      const b = atlas.data[o + 2] / 255;
      const cell = `${Math.floor(u * cols)},${Math.floor(v * rows)}`;
      const role = look.roles[cell];
      const entry = role ? palette.get(role) : undefined;
      if (!entry) {
        color.setRGB(r, g, b, THREE.SRGBColorSpace);
        return;
      }
      const shade = entry.style.shade === false ? 1 : Math.min(1.45, Math.max(0.55, lum(r, g, b) / (atlas.cellMean.get(cell) ?? 0.5)));
      color.copy(entry.color).multiplyScalar(shade);
      fx.set(entry.style.glow ?? 0, entry.style.metal ?? 0, entry.style.pattern ?? 0, 0);
    };
  }

  /** Bull: material slot (`_part`) -> role -> level palette. */
  private bullVertex(part: MergePart, look: CharacterLook, names: string[], palette: ReturnType<UnitLibrary['resolvePalette']>): void {
    const attr = part.mesh.geometry.getAttribute('_part') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const bySlot = names.map((n) => palette.get(look.roles[n] ?? n));
    part.vertex = (i, color, fx) => {
      const e = bySlot[Math.round(attr.getX(i))];
      if (!e) return;
      color.copy(e.color);
      fx.set(e.style.glow ?? 0, e.style.metal ?? 0, e.style.pattern ?? 0, 0);
    };
  }

  /** Height of the bare body (skinned parts only) in model units. */
  private restHeight(ch: CharacterId, skinned: THREE.SkinnedMesh[], skel: THREE.Skeleton): number {
    let h = this.restHeights.get(ch);
    if (h !== undefined) return h;
    const g = mergeSkinned(
      skel,
      skinned.map((mesh) => ({ mesh })),
    );
    const box = restBox(g, skel);
    g.dispose();
    h = Math.max(0.01, box.max.y - Math.min(0, box.min.y));
    this.restHeights.set(ch, h);
    return h;
  }

  /** Clips with per-bone pitch offsets folded in (bull: lowered, charging head). */
  private clips(ch: CharacterId, gltf: GLTF, look: CharacterLook, skel: THREE.Skeleton): THREE.AnimationClip[] {
    let c = this.clipCache.get(ch);
    if (c) return c;
    if (!look.bonePitch) {
      c = gltf.animations;
    } else {
      const pitch = look.bonePitch;
      c = gltf.animations.map((clip) => {
        const out = clip.clone();
        for (const track of out.tracks) {
          const [boneName, prop] = track.name.split('.');
          const ang = pitch[boneName];
          if (ang === undefined || prop !== 'quaternion') continue;
          const bone = skel.bones.find((b) => b.name === boneName);
          if (!bone) continue;
          // World +x at rest expressed in the bone's own frame.
          bone.getWorldQuaternion(tmpQ2);
          tmpV.set(1, 0, 0).applyQuaternion(tmpQ2.invert()).normalize();
          tmpQ.setFromAxisAngle(tmpV, ang);
          const vals = track.values;
          const q = new THREE.Quaternion();
          for (let k = 0; k < vals.length; k += 4) {
            q.set(vals[k], vals[k + 1], vals[k + 2], vals[k + 3]).multiply(tmpQ);
            vals[k] = q.x;
            vals[k + 1] = q.y;
            vals[k + 2] = q.z;
            vals[k + 3] = q.w;
          }
        }
        return out;
      });
    }
    this.clipCache.set(ch, c);
    return c;
  }

  private addFx(holder: THREE.Group, ch: CharacterId, lv: LevelLook, level: Level, owner: PlayerId, height: number): void {
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
