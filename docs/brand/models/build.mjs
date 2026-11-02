// GRID CLASH unit model pipeline (re-runnable). Produces, in public/models/:
//   hero.glb   heroic human body (Quaternius "Universal Base Characters", Superhero_Male) + the Ranger
//              outfit parts (Quaternius "Modular Character Outfits - Fantasy") re-bound to that body.
//              Shared by sad (paladin), marki (minotaur: human head hidden, bull head built at runtime)
//              and walk (shield soldier).
//   imp.glb    the Imp (Quaternius "Bestiary - Dungeon Monsters Kit"), body + shorts + chains + collar
//              (its mace is dropped). Used by insaner.
//   anims.glb  one skeleton + the clips every unit uses (Quaternius "Universal Animation Library" 1 + 2).
//              All three files share the UE-mannequin-style rig (bone names), so clips retarget by name.
//
//   node docs/brand/models/build.mjs --ubc <dir> --outfits <dir> --bestiary <dir> --ual1 <glb> --ual2 <glb>
//                                    [--out public/models]
//     --ubc       "Universal Base Characters[Standard]" folder (free/standard version, CC0)
//     --outfits   "Modular Character Outfits - Fantasy[Standard]" folder (CC0)
//     --bestiary  "Bestiary - Dungeon Monsters Kit[Standard]" folder (Quaternius Asset License v1.0)
//     --ual1      "Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb" (CC0)
//     --ual2      "Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb" (CC0)
//   Downloads: https://quaternius.com (or quaternius.itch.io), free "Standard" versions.
//
// Tooling (kept out of package.json on purpose, the game does not need it at runtime):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp gl-matrix
//   (or set GLTF_TOOLS=<dir with those node_modules> to resolve them from elsewhere)
//
// What it does:
//   - Every output is built from scratch: one skeleton (leaf bones dropped), one skin shared by all meshes
//     (bind pose = rest T-pose), plain attributes only (POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0,
//     COLOR_0 where baked). Normal / roughness / ORM maps are dropped (sub-pixel at board size).
//   - Outfit parts are skinned to the Regular_Male proportions: they are posed onto the hero's rest skeleton
//     with their own inverse binds (linear blend skinning), then bound to the hero skin. Heavy parts are
//     simplified with meshoptimizer.
//   - Eyes / eyebrows are baked to vertex colours; hero body (left) + Ranger outfit (right) share one
//     2048x1024 WebP atlas; the imp gets a 1024 WebP whose alpha is (1 - emissive mask) (glowing eyes).
//   - Clips: rotation tracks of every bone + the pelvis translation (bone lengths come from each body;
//     the runtime scales the pelvis track to the body's pelvis height). Resampled, quantized, meshopt.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const req = createRequire(process.env.GLTF_TOOLS ? join(resolve(process.env.GLTF_TOOLS), 'noop.js') : import.meta.url);
const load = (id) => {
  try {
    return req(id);
  } catch {
    console.error(`Missing ${id}. Install the tooling first (see the header of this file).`);
    process.exit(1);
  }
};
const { Document, NodeIO } = load('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTTextureWebP } = load('@gltf-transform/extensions');
const F = load('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptSimplifier } = load('meshoptimizer');
const sharp = load('sharp');
const { mat4, vec3 } = load('gl-matrix');

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const UBC = arg('--ubc');
const OUTFITS = arg('--outfits');
const BESTIARY = arg('--bestiary');
const UAL1 = arg('--ual1');
const UAL2 = arg('--ual2');
const outDir = resolve(root, arg('--out', 'public/models'));
if (!UBC || !OUTFITS || !BESTIARY || !UAL1 || !UAL2) {
  console.error('usage: node docs/brand/models/build.mjs --ubc <dir> --outfits <dir> --bestiary <dir> --ual1 <glb> --ual2 <glb> [--out public/models]');
  process.exit(1);
}
const HERO_DIR = join(resolve(UBC), 'Base Characters/Godot - UE');
const PARTS_DIR = join(resolve(OUTFITS), 'Exports/glTF (Godot-Unreal)/Modular Parts');
const BEST = resolve(BESTIARY);

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(outDir, { recursive: true });

/** Clips kept (source names; the runtime maps logical actions to them per character, see config.ts). */
const CLIPS = {
  ual1: ['Idle_Loop', 'Sword_Idle', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Sword_Attack', 'Punch_Cross', 'Hit_Chest', 'Death01'],
  ual2: [
    'Idle_Shield_Loop',
    'Idle_FoldArms_Loop',
    'Shield_OneShot',
    'Shield_Dash',
    'Sword_Regular_A',
    'Sword_Regular_B',
    'Melee_Hook',
    'NinjaJump_Start',
    'NinjaJump_Land',
  ],
};

// ------------------------------------------------------------------ helpers

/** Read a .gltf whose JSON references images that are not shipped (missing files become empty). */
async function readLoose(file) {
  if (file.endsWith('.glb')) return io.read(file);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const dir = dirname(file);
  const resources = {};
  for (const b of json.buffers ?? []) resources[b.uri] = new Uint8Array(readFileSync(join(dir, decodeURIComponent(b.uri))));
  // Textures are read separately (sharp); drop image references so nothing else is decoded.
  for (const m of json.materials ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  return io.readJSON({ json, resources });
}

/** Rest-pose world matrices of every node of the (first) scene. */
function worldMatrices(doc) {
  const out = new Map();
  const walk = (n, parent) => {
    const m = mat4.multiply(mat4.create(), parent, n.getMatrix());
    out.set(n, m);
    for (const c of n.listChildren()) walk(c, m);
  };
  for (const n of doc.getRoot().listScenes()[0].listChildren()) walk(n, mat4.create());
  return out;
}

const isLeaf = (name) => /leaf/i.test(name);

/** Skeleton description from a source doc: bones (non-leaf joints of the first skin) in hierarchy order. */
function skeletonOf(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const world = worldMatrices(doc);
  const joints = skin.listJoints().filter((j) => !isLeaf(j.getName()));
  const set = new Set(joints);
  const bones = joints.map((j) => {
    let p = j.getParentNode();
    while (p && !set.has(p)) p = p.getParentNode();
    return {
      name: j.getName(),
      parent: p ? p.getName() : null,
      t: j.getTranslation(),
      r: j.getRotation(),
      s: j.getScale(),
      world: world.get(j),
    };
  });
  // Root of the bone tree keeps its full world transform (the source's Armature node is identity).
  for (const b of bones) {
    if (b.parent) continue;
    const m = b.world;
    b.t = [...mat4.getTranslation(vec3.create(), m)];
    b.r = [...mat4.getRotation([0, 0, 0, 1], m)];
    b.s = [...mat4.getScaling(vec3.create(), m)];
  }
  return { bones, index: new Map(bones.map((b, i) => [b.name, i])) };
}

/**
 * Extract a skinned primitive posed onto `target` rest bones with the source's own inverse binds
 * (linear blend skinning). For a mesh of the same body this is the identity; for outfit parts made
 * for another body it refits them to the target proportions. Weights on dropped (leaf) bones move to
 * the nearest kept ancestor.
 */
function extract(prim, skin, target) {
  const P = prim.getAttribute('POSITION');
  const N = prim.getAttribute('NORMAL');
  const UV = prim.getAttribute('TEXCOORD_0');
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  const ibm = skin.getInverseBindMatrices();
  const joints = skin.listJoints();
  // Source joint -> target bone index (+ skin matrix target.world * source.ibm).
  const map = joints.map((j) => {
    let n = j;
    while (n && !target.index.has(n.getName())) n = n.getParentNode();
    if (!n) throw new Error(`joint ${j.getName()} has no target bone`);
    return target.index.get(n.getName());
  });
  const skinM = joints.map((j, i) => {
    let n = j;
    while (!target.index.has(n.getName())) n = n.getParentNode();
    const tw = target.bones[target.index.get(n.getName())].world;
    // Leaf joints follow their kept ancestor rigidly: use the ancestor's own source bind.
    const k = joints.indexOf(n);
    return mat4.multiply(mat4.create(), tw, ibm.getElement(k >= 0 ? k : i, new Array(16)));
  });
  const n = P.getCount();
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const ji = new Uint16Array(n * 4);
  const wt = new Float32Array(n * 4);
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const jj = [0, 0, 0, 0];
  const ww = [0, 0, 0, 0];
  const m = new Float32Array(16);
  for (let i = 0; i < n; i++) {
    P.getElement(i, p);
    N.getElement(i, q);
    J.getElement(i, jj);
    W.getElement(i, ww);
    m.fill(0);
    const acc = new Map();
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      if (ww[k] <= 0) continue;
      const sm = skinM[jj[k]];
      for (let e = 0; e < 16; e++) m[e] += sm[e] * ww[k];
      const t = map[jj[k]];
      acc.set(t, (acc.get(t) ?? 0) + ww[k]);
      sum += ww[k];
    }
    const v = vec3.transformMat4(vec3.create(), p, m);
    pos.set(v, i * 3);
    const nm = mat4.invert(mat4.create(), m);
    mat4.transpose(nm, nm);
    const nn = vec3.normalize(vec3.create(), [nm[0] * q[0] + nm[4] * q[1] + nm[8] * q[2], nm[1] * q[0] + nm[5] * q[1] + nm[9] * q[2], nm[2] * q[0] + nm[6] * q[1] + nm[10] * q[2]]);
    nor.set(nn, i * 3);
    if (UV) {
      const u = UV.getElement(i, [0, 0]);
      uv[i * 2] = u[0];
      uv[i * 2 + 1] = u[1];
    }
    const list = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    list.forEach(([t, w], k) => {
      ji[i * 4 + k] = t;
      wt[i * 4 + k] = w / sum;
    });
  }
  const idx = prim.getIndices();
  const index = idx ? Uint32Array.from(idx.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
  return { pos, nor, uv, ji, wt, index, color: null };
}

/** Concatenate extracted parts. */
function concat(parts) {
  let vc = 0;
  let ic = 0;
  for (const p of parts) {
    vc += p.pos.length / 3;
    ic += p.index.length;
  }
  const out = {
    pos: new Float32Array(vc * 3),
    nor: new Float32Array(vc * 3),
    uv: new Float32Array(vc * 2),
    ji: new Uint16Array(vc * 4),
    wt: new Float32Array(vc * 4),
    index: new Uint32Array(ic),
    color: parts.some((p) => p.color) ? new Float32Array(vc * 3).fill(1) : null,
  };
  let vo = 0;
  let io2 = 0;
  for (const p of parts) {
    const n = p.pos.length / 3;
    out.pos.set(p.pos, vo * 3);
    out.nor.set(p.nor, vo * 3);
    out.uv.set(p.uv, vo * 2);
    out.ji.set(p.ji, vo * 4);
    out.wt.set(p.wt, vo * 4);
    if (out.color && p.color) out.color.set(p.color, vo * 3);
    for (let k = 0; k < p.index.length; k++) out.index[io2 + k] = p.index[k] + vo;
    io2 += p.index.length;
    vo += n;
  }
  return out;
}

/** meshoptimizer simplification (keeps borders and UV seams), then drops unused vertices. */
function simplify(part, ratio, error = 0.01) {
  const n = part.pos.length / 3;
  const attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    attrs.set(part.nor.subarray(i * 3, i * 3 + 3), i * 5);
    attrs[i * 5 + 3] = part.uv[i * 2] * 2;
    attrs[i * 5 + 4] = part.uv[i * 2 + 1] * 2;
  }
  const target = Math.floor((part.index.length * ratio) / 3) * 3;
  const [index] = MeshoptSimplifier.simplifyWithAttributes(part.index, part.pos, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, target, error, ['LockBorder']);
  return compact({ ...part, index });
}

function compact(part) {
  const n = part.pos.length / 3;
  const remap = new Int32Array(n).fill(-1);
  let c = 0;
  for (const i of part.index) if (remap[i] < 0) remap[i] = c++;
  const sel = (arr, k) => {
    const o = new arr.constructor(c * k);
    for (let i = 0; i < n; i++) if (remap[i] >= 0) o.set(arr.subarray(i * k, i * k + k), remap[i] * k);
    return o;
  };
  return {
    pos: sel(part.pos, 3),
    nor: sel(part.nor, 3),
    uv: sel(part.uv, 2),
    ji: sel(part.ji, 4),
    wt: sel(part.wt, 4),
    color: part.color ? sel(part.color, 3) : null,
    index: Uint32Array.from(part.index, (i) => remap[i]),
  };
}

const lin = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** Bake a texture into linear vertex colours (UVs wrap), then clear the UVs. */
async function bakeColors(part, file, gain = 1) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = part.pos.length / 3;
  part.color = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = part.uv[i * 2] - Math.floor(part.uv[i * 2]);
    const v = part.uv[i * 2 + 1] - Math.floor(part.uv[i * 2 + 1]);
    const x = Math.min(info.width - 1, Math.round(u * (info.width - 1)));
    const y = Math.min(info.height - 1, Math.round(v * (info.height - 1)));
    const o = (y * info.width + x) * 3;
    for (let k = 0; k < 3; k++) part.color[i * 3 + k] = Math.min(1, lin(data[o + k]) * gain);
  }
  part.uv.fill(0);
}

/** u' = u * su + ou. */
function remapU(part, su, ou) {
  for (let i = 0; i < part.uv.length; i += 2) part.uv[i] = part.uv[i] * su + ou;
}

/** A fresh document: skeleton (one skin), meshes sharing it, one textured material. */
function buildDoc(skel, meshes, image) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const armature = doc.createNode('Armature');
  scene.addChild(armature);
  const nodes = skel.bones.map((b) => doc.createNode(b.name).setTranslation(b.t).setRotation(b.r).setScale(b.s));
  skel.bones.forEach((b, i) => {
    if (b.parent) nodes[skel.index.get(b.parent)].addChild(nodes[i]);
    else armature.addChild(nodes[i]);
  });
  const ibm = new Float32Array(skel.bones.length * 16);
  skel.bones.forEach((b, i) => ibm.set(mat4.invert(mat4.create(), b.world), i * 16));
  const skin = doc.createSkin('Armature').setSkeleton(nodes[skel.bones.findIndex((b) => !b.parent)]);
  nodes.forEach((n) => skin.addJoint(n));
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  let material = null;
  if (image) {
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const tex = doc.createTexture('atlas').setImage(image).setMimeType('image/webp');
    material = doc.createMaterial('unit').setBaseColorTexture(tex).setRoughnessFactor(0.7).setMetallicFactor(0);
  }
  for (const m of meshes) {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', m.pos))
      .setAttribute('NORMAL', acc('VEC3', m.nor))
      .setAttribute('TEXCOORD_0', acc('VEC2', m.uv))
      .setAttribute('JOINTS_0', acc('VEC4', m.ji))
      .setAttribute('WEIGHTS_0', acc('VEC4', m.wt))
      .setIndices(acc('SCALAR', m.pos.length / 3 > 65535 ? m.index : Uint16Array.from(m.index)));
    if (m.color) prim.setAttribute('COLOR_0', acc('VEC3', m.color));
    if (material) prim.setMaterial(material);
    const mesh = doc.createMesh(m.name).addPrimitive(prim);
    armature.addChild(doc.createNode(m.name).setMesh(mesh).setSkin(skin));
  }
  return doc;
}

async function finalize(doc, outName, opts = {}) {
  await doc.transform(
    F.prune(),
    ...(opts.anim ? [F.resample({ tolerance: 2e-4 })] : []),
    F.prune(),
    ...(opts.anim ? [] : [F.quantize({ quantizationVolume: 'scene', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8, pattern: /^(POSITION|NORMAL|TEXCOORD_0|COLOR_0|WEIGHTS_0)$/ })]),
    F.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = join(outDir, outName);
  await io.write(out, doc);
  console.log(`${outName}: ${(statSync(out).size / 1024).toFixed(1)} KB`);
}

const triCount = (parts) => parts.reduce((s, p) => s + p.index.length / 3, 0);

// ------------------------------------------------------------------ hero.glb
{
  const src = await readLoose(join(HERO_DIR, 'Superhero_Male_FullBody.gltf'));
  const skel = skeletonOf(src);
  const skin = src.getRoot().listSkins()[0];
  const byNode = (name) => src.getRoot().listNodes().find((n) => n.getName() === name).getMesh().listPrimitives()[0];
  const body = extract(byNode('SuperHero_Male'), skin, skel);
  remapU(body, 0.5, 0);
  const eyes = extract(byNode('Eyes'), skin, skel);
  await bakeColors(eyes, join(HERO_DIR, 'T_Eye_Brown.png'));
  const brows = extract(byNode('Eyebrows'), skin, skel);
  await bakeColors(brows, join(HERO_DIR, 'T_Hair_1_BaseColor.png'));

  // Ranger outfit parts (Regular_Male proportions) refitted to the hero skeleton.
  const ranger = async (file, ratio) => {
    const doc = await readLoose(join(PARTS_DIR, file));
    const sk = doc.getRoot().listSkins()[0];
    const parts = [];
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh || !node.getSkin()) continue;
      for (const prim of mesh.listPrimitives()) parts.push(extract(prim, node.getSkin() ?? sk, skel));
    }
    let p = concat(parts);
    if (ratio < 1) p = simplify(p, ratio);
    remapU(p, 0.5, 0.5);
    return p;
  };
  const meshes = [
    { name: 'Body', ...body },
    { name: 'Eyes', ...eyes },
    { name: 'Brows', ...brows },
    { name: 'Ranger_Torso', ...(await ranger('Male_Ranger_Body.gltf', 0.6)) },
    { name: 'Ranger_Arms', ...(await ranger('Male_Ranger_Arms.gltf', 0.45)) },
    { name: 'Ranger_Legs', ...(await ranger('Male_Ranger_Legs.gltf', 1)) },
    { name: 'Ranger_Boots', ...(await ranger('Male_Ranger_Feet_Boots.gltf', 0.28)) },
    { name: 'Ranger_Pauldron', ...(await ranger('Male_Ranger_Acc_Pauldron.gltf', 0.6)) },
  ];
  for (const m of meshes) console.log(`  hero ${m.name}: ${m.index.length / 3} tris, ${m.pos.length / 3} verts`);
  console.log(`  hero total ${triCount(meshes)} tris`);
  const half = (f) => sharp(f).resize(1024, 1024, { kernel: 'lanczos3' }).removeAlpha().png().toBuffer();
  const image = await sharp({ create: { width: 2048, height: 1024, channels: 3, background: '#000000' } })
    .composite([
      { input: await half(join(HERO_DIR, 'T_Superhero_Male_Dark.png')), left: 0, top: 0 },
      { input: await half(join(resolve(OUTFITS), 'Textures/Ranger/T_Ranger_BaseColor.png')), left: 1024, top: 0 },
    ])
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  await finalize(buildDoc(skel, meshes, image), 'hero.glb');
}

// ------------------------------------------------------------------ imp.glb
{
  const src = await readLoose(join(BEST, 'Exports/GLB (Godot-Unreal)/Imp.glb'));
  const skel = skeletonOf(src);
  const meshes = [];
  const names = { Imp_Body: 'Body', Imp_Shorts: 'Shorts', Imp_Chains: 'Chains', Imp_SpikedCollar: 'Collar' };
  for (const node of src.getRoot().listNodes()) {
    const name = names[node.getName()];
    if (!name) continue;
    meshes.push({ name, ...extract(node.getMesh().listPrimitives()[0], node.getSkin(), skel) });
  }
  for (const m of meshes) console.log(`  imp ${m.name}: ${m.index.length / 3} tris`);
  const tex = (f) => join(BEST, 'Textures', f);
  const base = await sharp(tex('T_Imp_BaseColor_1.png')).resize(1024, 1024, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  const emis = await sharp(tex('T_Imp_Emissive.png')).resize(1024, 1024, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
  const rgba = Buffer.alloc(1024 * 1024 * 4);
  for (let i = 0; i < 1024 * 1024; i++) {
    rgba[i * 4] = base[i * 3];
    rgba[i * 4 + 1] = base[i * 3 + 1];
    rgba[i * 4 + 2] = base[i * 3 + 2];
    rgba[i * 4 + 3] = 255 - emis[i];
  }
  const image = await sharp(rgba, { raw: { width: 1024, height: 1024, channels: 4 } })
    .webp({ quality: 84, alphaQuality: 90, effort: 6, exact: true })
    .toBuffer();
  await finalize(buildDoc(skel, meshes, image), 'imp.glb');
}

// ------------------------------------------------------------------ anims.glb
{
  const docs = { ual1: await io.read(resolve(UAL1)), ual2: await io.read(resolve(UAL2)) };
  const skel = skeletonOf(docs.ual1);
  const doc = buildDoc(skel, [], null);
  const buffer = doc.getRoot().listBuffers()[0];
  const nodeByName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
  for (const [lib, names] of Object.entries(CLIPS)) {
    const animByName = new Map(docs[lib].getRoot().listAnimations().map((a) => [a.getName(), a]));
    for (const name of names) {
      const src = animByName.get(name);
      if (!src) throw new Error(`clip ${name} missing in ${lib}`);
      const anim = doc.createAnimation(name);
      for (const ch of src.listChannels()) {
        const bone = ch.getTargetNode().getName();
        const path = ch.getTargetPath();
        const node = nodeByName.get(bone);
        if (!node || isLeaf(bone)) continue;
        if (path !== 'rotation' && !(path === 'translation' && bone === 'pelvis')) continue;
        const s = ch.getSampler();
        const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(s.getInput().getArray())).setBuffer(buffer);
        const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(s.getOutput().getArray())).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
      }
    }
  }
  console.log(`  anims: ${doc.getRoot().listAnimations().length} clips, ${skel.bones.length} bones`);
  await finalize(doc, 'anims.glb', { anim: true });
}

if (!existsSync(join(outDir, 'hero.glb'))) process.exit(1);
