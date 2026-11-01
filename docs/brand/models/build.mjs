// GRID CLASH unit model pipeline (re-runnable). Produces public/models/{sad,marki,walk}.glb.
//
//   node docs/brand/models/build.mjs --kaykit <KayKit-Adventurers-dir> --bull <Bull.glb> [--out public/models]
//
// Sources (all CC0, see public/models/LICENSES.md):
//   --kaykit  checkout of https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//             (git clone --depth 1 ...; the script reads addons/kaykit_character_pack_adventures/...)
//   --bull    raw GLB converted from Quaternius "Ultimate Animated Animals" Bull.blend with
//             docs/brand/models/blend2glb.py (needs Blender or `pip install bpy==4.2.0` on Python 3.11)
//
// Tooling (kept out of package.json on purpose, the game does not need it at runtime):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp
//   (or set GLTF_TOOLS=<dir with those node_modules> to resolve them from elsewhere)
//
// What it does per unit:
//   sad   (paladin)        KayKit Knight: body + helmet + cape, 1H sword, round shield, team badge shield
//                          (shield_badge_color), golden greatsword (sword_2handed_color) for Lv3.
//   walk  (shield bearer)  KayKit Barbarian: body + hat + cape, 1H axe, round shield + team spiked shield
//                          and team tower shield (knight-atlas props, merged into one 2:1 atlas).
//   marki (bull)           Quaternius Bull: per-material colours baked into COLOR_0, one material.
//   Then: keep only the clips the board uses, prune, dedup, resample, quantize, meshopt (EXT_meshopt_compression).
//   Textures are palette atlases: downscaled to 256 px (512x256 for the merged walk atlas), PNG.
import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const req = createRequire(process.env.GLTF_TOOLS ? join(resolve(process.env.GLTF_TOOLS), 'noop.js') : import.meta.url);
const load = (id) => {
  try {
    return req(id);
  } catch {
    console.error(`Missing ${id}. Install the tooling first (see the header of this file).`);
    process.exit(1);
  }
};
const { NodeIO } = load('@gltf-transform/core');
const { ALL_EXTENSIONS } = load('@gltf-transform/extensions');
const F = load('@gltf-transform/functions');
const { MeshoptEncoder } = load('meshoptimizer');
const sharp = load('sharp');

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const kaykitDir = arg('--kaykit');
const bullPath = arg('--bull');
const outDir = resolve(root, arg('--out', 'public/models'));
if (!kaykitDir || !bullPath) {
  console.error('usage: node docs/brand/models/build.mjs --kaykit <dir> --bull <Bull.glb> [--out public/models]');
  process.exit(1);
}
const KK = join(resolve(kaykitDir), 'addons/kaykit_character_pack_adventures');
const CHAR = (n) => join(KK, 'Characters/gltf', n);
const PROP = (n) => join(KK, 'Assets/gltf', n);
const TEX = (n) => join(KK, 'Textures', n);

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(outDir, { recursive: true });

/** Clips kept per rig (renamed to the logical names the runtime uses). */
const HUMANOID_CLIPS = {
  sad: {
    idle: 'Idle',
    run: 'Running_A',
    attack: '1H_Melee_Attack_Slice_Diagonal',
    hit: 'Hit_A',
    death: 'Death_A',
    cheer: 'Cheer',
  },
  walk: {
    idle: 'Idle',
    run: 'Running_A',
    jump: 'Jump_Full_Short',
    attack: 'Block_Attack',
    hit: 'Block_Hit',
    death: 'Death_A',
    cheer: 'Cheer',
  },
};
const BULL_CLIPS = {
  idle: 'Idle',
  run: 'Gallop',
  attack: 'Attack_Headbutt',
  hit: 'Idle_HitReact_Left',
  death: 'Death',
  cheer: 'Idle_Headlow',
};

function keepClips(doc, map) {
  const byName = new Map(doc.getRoot().listAnimations().map((a) => [a.getName(), a]));
  const keep = new Set();
  for (const [logical, src] of Object.entries(map)) {
    const a = byName.get(src);
    if (!a) throw new Error(`clip ${src} missing`);
    a.setName(logical);
    keep.add(a);
  }
  for (const a of doc.getRoot().listAnimations()) if (!keep.has(a)) a.dispose();
}

function dropNodes(doc, names) {
  for (const n of doc.getRoot().listNodes()) if (names.includes(n.getName())) n.dispose();
}

function findNode(doc, name) {
  const n = doc.getRoot().listNodes().find((x) => x.getName() === name);
  if (!n) throw new Error(`node ${name} missing`);
  return n;
}

/** Import the first mesh of a prop .gltf into `doc` and return it (material/texture come along). */
async function importPropMesh(doc, file) {
  const src = await io.read(PROP(file));
  const mesh = src.getRoot().listMeshes()[0];
  const map = F.copyToDocument(doc, src, [mesh]);
  return map.get(mesh);
}

/** Scale/offset TEXCOORD_0 of every primitive of `mesh` (u' = u * su + ou), unsharing accessors. */
function remapU(mesh, su, ou, done) {
  for (const prim of mesh.listPrimitives()) {
    let uv = prim.getAttribute('TEXCOORD_0');
    if (!uv || done.has(uv)) continue;
    if (uv.listParents().filter((p) => p.propertyType === 'Primitive').length > 1) {
      uv = uv.clone();
      prim.setAttribute('TEXCOORD_0', uv);
    }
    const el = [0, 0];
    for (let i = 0; i < uv.getCount(); i++) {
      uv.getElement(i, el);
      el[0] = el[0] * su + ou;
      uv.setElement(i, el);
    }
    done.add(uv);
  }
}

async function pngTexture(doc, buf, name) {
  const tex = doc.createTexture(name).setImage(buf).setMimeType('image/png');
  return tex;
}

async function finalize(doc, outName) {
  // The board renders these with its own lighting: no lights/cameras/extras needed.
  await doc.transform(
    F.prune({ keepAttributes: false, keepLeaves: false }),
    F.dedup(),
    F.resample({ tolerance: 1e-4 }),
    F.prune(),
    F.quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8 }),
    F.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = join(outDir, outName);
  await io.write(out, doc);
  console.log(`${outName}: ${(statSync(out).size / 1024).toFixed(1)} KB`);
}

/** Single shared material for a humanoid; returns it after pointing every primitive at it. */
function unifyMaterial(doc, tex) {
  const mats = doc.getRoot().listMaterials();
  const mat = mats[0];
  mat.setName('atlas').setBaseColorTexture(tex).setRoughnessFactor(0.75).setMetallicFactor(0).setDoubleSided(false);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) p.setMaterial(mat);
  for (const m of mats) if (m !== mat) m.dispose();
  return mat;
}

// ------------------------------------------------------------------ sad (paladin)
{
  const doc = await io.read(CHAR('Knight.glb'));
  keepClips(doc, HUMANOID_CLIPS.sad);
  dropNodes(doc, ['1H_Sword_Offhand', 'Rectangle_Shield', 'Spike_Shield']);
  findNode(doc, 'Badge_Shield').setMesh(await importPropMesh(doc, 'shield_badge_color.gltf'));
  findNode(doc, '2H_Sword').setMesh(await importPropMesh(doc, 'sword_2handed_color.gltf'));
  const png = await sharp(TEX('knight_texture.png')).resize(256, 256, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
  unifyMaterial(doc, await pngTexture(doc, png, 'knight_atlas'));
  doc.getRoot().listScenes()[0].setExtras({ atlas: 'knight' });
  await finalize(doc, 'sad.glb');
}

// ------------------------------------------------------------------ walk (shield bearer)
{
  const doc = await io.read(CHAR('Barbarian.glb'));
  keepClips(doc, HUMANOID_CLIPS.walk);
  dropNodes(doc, ['1H_Axe_Offhand', '2H_Axe', 'Mug']);
  const done = new Set();
  // Barbarian meshes -> left half of the merged atlas.
  for (const mesh of doc.getRoot().listMeshes()) remapU(mesh, 0.5, 0, done);
  const round = findNode(doc, 'Barbarian_Round_Shield');
  const hand = round.getParentNode();
  for (const [name, file] of [
    ['Spike_Shield', 'shield_spikes_color.gltf'],
    ['Tower_Shield', 'shield_square_color.gltf'],
  ]) {
    const mesh = await importPropMesh(doc, file);
    remapU(mesh, 0.5, 0.5, done); // knight-atlas props -> right half
    const n = doc.createNode(name).setMesh(mesh).setTranslation(round.getTranslation()).setRotation(round.getRotation());
    hand.addChild(n);
  }
  const half = async (f) => sharp(TEX(f)).resize(256, 256, { kernel: 'lanczos3' }).png().toBuffer();
  const png = await sharp({ create: { width: 512, height: 256, channels: 4, background: '#000000ff' } })
    .composite([
      { input: await half('barbarian_texture.png'), left: 0, top: 0 },
      { input: await half('knight_texture.png'), left: 256, top: 0 },
    ])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  unifyMaterial(doc, await pngTexture(doc, png, 'barbarian_knight_atlas'));
  doc.getRoot().listScenes()[0].setExtras({ atlas: 'barbarian|knight' });
  await finalize(doc, 'walk.glb');
}

// ------------------------------------------------------------------ marki (bull)
{
  const doc = await io.read(resolve(bullPath));
  keepClips(doc, BULL_CLIPS);
  const colors = {};
  const mat = doc.createMaterial('bull').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const m = prim.getMaterial();
      const c = m ? m.getBaseColorFactor().slice(0, 3) : [1, 1, 1];
      colors[m ? m.getName() : 'none'] = c;
      const n = prim.getAttribute('POSITION').getCount();
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set(c, i * 3);
      prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(doc.getRoot().listBuffers()[0]));
      prim.setMaterial(mat);
    }
  }
  await doc.transform(F.join({ keepNamed: false }));
  // Linear vertex colours of the authored material slots; the runtime re-tints by matching them.
  doc.getRoot().listScenes()[0].setExtras({ materialColors: colors });
  for (const m of doc.getRoot().listMaterials()) if (m !== mat) m.dispose();
  await finalize(doc, 'marki.glb');
}
