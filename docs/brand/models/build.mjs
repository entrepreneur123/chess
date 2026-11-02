// GRID CLASH unit model pipeline (re-runnable). Produces public/models/{sad,marki,walk,insaner}.glb.
//
//   node docs/brand/models/build.mjs --kaykit <KayKit-Adventurers-dir> --bull <Bull.glb> [--out public/models]
//                                    [--only sad,walk,marki,insaner]   (--bull is only needed for marki)
//
// Sources (all CC0, see public/models/LICENSES.md):
//   --kaykit  checkout of https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//             (git clone --depth 1 ...; the script reads addons/kaykit_character_pack_adventures/...)
//   --bull    raw GLB converted from Quaternius "Ultimate Animated Animals" Bull.blend with
//             docs/brand/models/blend2glb.py (needs Blender or `pip install bpy==4.2.0` on Python 3.11)
//
// Tooling (kept out of package.json on purpose, the game does not need it at runtime):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp gl-matrix
//   (or set GLTF_TOOLS=<dir with those node_modules> to resolve them from elsewhere)
//
// What it does per unit:
//   sad   (paladin)        KayKit Knight: body + helmet + cape, 1H sword, round shield, team badge shield
//                          (shield_badge_color), golden greatsword (sword_2handed_color) for Lv3.
//   walk  (shield bearer)  KayKit Barbarian: body + hat + cape, 1H axe, round shield + team spiked shield
//                          and team tower shield (knight-atlas props, merged into one 2:1 atlas).
//   marki (bull)           Quaternius Bull: per-material colours baked into COLOR_0, one material.
//   insaner (imp)          KayKit Rogue: body + hair head, both knives (Lv2/Lv3 daggers); horns, tail, grin,
//                          loincloth / jester coat / flame cape and the Lv3 orbit shards are generated at runtime.
//   Then: keep only the clips the board uses, prune, dedup, resample, quantize, meshopt (EXT_meshopt_compression).
//   Textures are palette atlases: downscaled to 256 px (512x256 for the merged walk atlas), PNG.
import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'node:fs';
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
const only = arg('--only', 'sad,walk,marki,insaner').split(',');
const want = (n) => only.includes(n);
if (!kaykitDir || (want('marki') && !bullPath)) {
  console.error('usage: node docs/brand/models/build.mjs --kaykit <dir> --bull <Bull.glb> [--out public/models] [--only a,b]');
  process.exit(1);
}
const KK = join(resolve(kaykitDir), 'addons/kaykit_character_pack_adventures');
const CHAR = (n) => join(KK, 'Characters/gltf', n);
const PROP = (n) => join(KK, 'Assets/gltf', n);
const TEX = (n) => join(KK, 'Textures', n);

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(outDir, { recursive: true });


/** Clips kept per rig, renamed to the logical names the runtime uses. */
const CLIPS = {
  sad: {
    idle: 'Idle',
    run: 'Running_A',
    attack: '1H_Melee_Attack_Slice_Diagonal',
    death: 'Death_A',
  },
  walk: {
    idle: 'Idle',
    run: 'Running_A',
    jump: 'Jump_Full_Short',
    attack: 'Block_Attack',
    death: 'Death_A',
  },
  marki: {
    idle: 'Idle',
    run: 'Gallop',
    attack: 'Attack_Headbutt',
    death: 'Death',
  },
  insaner: {
    idle: 'Idle',
    run: 'Running_A',
    jump: 'Jump_Full_Short',
    attack: 'Dualwield_Melee_Attack_Slice',
    death: 'Death_B',
  },
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
  for (const a of doc.getRoot().listAnimations()) {
    if (keep.has(a)) continue;
    // Samplers keep their accessors alive (prune would not see them as orphans): drop explicitly.
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose(); // accessors may be shared: prune() drops orphans
    a.dispose();
  }
}

const findNode = (doc, name) => {
  const n = doc.getRoot().listNodes().find((x) => x.getName() === name);
  if (!n) throw new Error(`node ${name} missing`);
  return n;
};
const dropNodes = (doc, names) => names.forEach((n) => findNode(doc, n).dispose());

/** Copy the first mesh of another glTF file into `doc` (material/texture come along, pruned later). */
async function importMesh(doc, file, meshName) {
  const src = await io.read(file);
  const meshes = src.getRoot().listMeshes();
  const mesh = meshName ? src.getRoot().listNodes().find((n) => n.getName() === meshName)?.getMesh() : meshes[0];
  if (!mesh) throw new Error(`mesh ${meshName} missing in ${file}`);
  return F.copyToDocument(doc, src, [mesh]).get(mesh);
}

/** u' = u * su + ou on every primitive of `mesh` (accessors are unshared first). */
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

/**
 * Drop every triangle of `mesh` whose three vertices sample an atlas cell accepted by `cellOf(col,row)`
 * (8 x 4 KayKit palette grid). Used to strip the rogue's hair so the imp gets a bare, horned skull.
 */
function dropCellTriangles(mesh, cellOf) {
  for (const prim of mesh.listPrimitives()) {
    const uv = prim.getAttribute('TEXCOORD_0');
    const idx = prim.getIndices();
    if (!uv || !idx) continue;
    const e = [0, 0];
    const inCell = (i) => {
      uv.getElement(i, e);
      return cellOf(Math.floor(e[0] * 8), Math.floor(e[1] * 4));
    };
    const keep = [];
    for (let k = 0; k < idx.getCount(); k += 3) {
      const a = idx.getScalar(k);
      const b = idx.getScalar(k + 1);
      const c = idx.getScalar(k + 2);
      if (inCell(a) && inCell(b) && inCell(c)) continue;
      keep.push(a, b, c);
    }
    const arr = keep.length > 65535 ? new Uint32Array(keep) : new Uint16Array(keep);
    prim.setIndices(mesh.getGraph() ? idx.clone().setArray(arr) : idx);
  }
}

/** Attach a new node carrying `mesh` to `parent`, with the TRS of `like` (a sibling slot node). */
function attach(doc, parent, name, mesh, like) {
  const n = doc.createNode(name).setMesh(mesh);
  if (like) n.setTranslation(like.getTranslation()).setRotation(like.getRotation()).setScale(like.getScale());
  parent.addChild(n);
  return n;
}

/** Point every primitive at one material carrying the atlas texture. */
function unifyMaterial(doc, png, name) {
  const tex = doc.createTexture(name).setImage(png).setMimeType('image/png');
  const mat = doc.createMaterial('atlas').setBaseColorTexture(tex).setRoughnessFactor(0.75).setMetallicFactor(0);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) p.setMaterial(mat);
}

/** Drop animation channels whose (resampled) output never leaves the node's rest value. */
function dropStaticChannels(doc) {
  let n = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const out = ch.getSampler()?.getOutput();
      if (!node || !out || path === 'weights') continue;
      const rest = path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : node.getScale();
      const el = [];
      let still = true;
      for (let i = 0; i < out.getCount() && still; i++) {
        out.getElement(i, el);
        let d = 0;
        for (let k = 0; k < el.length; k++) d = Math.max(d, Math.abs(el[k] - rest[k]));
        // Quaternions q and -q are the same rotation.
        if (path === 'rotation' && d > 1e-4) {
          d = 0;
          for (let k = 0; k < el.length; k++) d = Math.max(d, Math.abs(-el[k] - rest[k]));
        }
        if (d > 1e-4) still = false;
      }
      if (still) {
        ch.getSampler().dispose();
        ch.dispose();
        n++;
      }
    }
  }
  return n;
}

async function finalize(doc, outName) {
  await doc.transform(F.resample({ tolerance: 1e-4 }));
  const dropped = dropStaticChannels(doc);
  await doc.transform(
    F.unpartition(),
    F.prune(),
    F.dedup(),
    F.resample({ tolerance: 1e-4 }),
    F.prune(),
    F.quantize({ quantizationVolume: 'scene', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8, pattern: /^(POSITION|NORMAL|TEXCOORD_0|COLOR_0|WEIGHTS_0)$/ }),
    F.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = join(outDir, outName);
  await io.write(out, doc);
  console.log(`${outName}: ${(statSync(out).size / 1024).toFixed(1)} KB (${dropped} static channels dropped)`);
}

const { mat4, quat, vec3 } = load('gl-matrix');
const yRot = (a) => quat.setAxisAngle(quat.create(), [0, 1, 0], a);
const xRot = (a) => quat.setAxisAngle(quat.create(), [1, 0, 0], a);
const zRot = (a) => quat.setAxisAngle(quat.create(), [0, 0, 1], a);
const qmul = (a, b) => quat.multiply(quat.create(), a, b);

/** Parent `mesh` to `boneName` so that it ends up at the given rest-pose world placement. */
function place(doc, name, mesh, boneName, pos, rot, scale) {
  const bone = findNode(doc, boneName);
  const want = mat4.fromRotationTranslationScale(mat4.create(), rot, pos, [scale, scale, scale]);
  const local = mat4.multiply(mat4.create(), mat4.invert(mat4.create(), bone.getWorldMatrix()), want);
  const t = mat4.getTranslation(vec3.create(), local);
  const r = mat4.getRotation(quat.create(), local);
  const sc = mat4.getScaling(vec3.create(), local);
  const n = doc.createNode(name).setMesh(mesh).setTranslation([...t]).setRotation([...r]).setScale([...sc]);
  bone.addChild(n);
  return n;
}

const atlas256 = (f) => sharp(TEX(f)).resize(256, 256, { kernel: 'lanczos3' }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();

// ------------------------------------------------------------------ sad (paladin, KayKit Knight)
// Lv1 helmet + short sword; Lv2 + team cape + greatsword + pauldrons; Lv3 golden greatsword (+ runtime gold
// armour, halo, aura). The team plume is generated at runtime.
if (want('sad')) {
  const doc = await io.read(CHAR('Knight.glb'));
  keepClips(doc, CLIPS.sad);
  dropNodes(doc, ['1H_Sword_Offhand', 'Rectangle_Shield', 'Spike_Shield', 'Round_Shield', 'Badge_Shield']);
  const sword2 = findNode(doc, '2H_Sword');
  attach(doc, sword2.getParentNode(), 'Gold_Sword', await importMesh(doc, PROP('sword_2handed_color.gltf')), sword2);
  // Lv2+ pauldrons: small round steel shields on both shoulders, tilted up/outwards.
  const pauldron = await importMesh(doc, PROP('shield_round.gltf'));
  for (const [side, sx] of [['l', 1], ['r', -1]]) {
    const rot = qmul(zRot(-sx * 1.0), xRot(-Math.PI / 2));
    place(doc, `Pauldron_${side.toUpperCase()}`, pauldron, `upperarm.${side}`, [sx * 0.45, 1.25, 0], rot, 0.72);
  }
  unifyMaterial(doc, await atlas256('knight_texture.png'), 'knight_atlas');
  await finalize(doc, 'sad.glb');
}

// ------------------------------------------------------------------ walk (shield bearer, KayKit Barbarian)
// Lv1 bear hat + round wooden shield + axe; Lv2 + pauldrons, team kite shield + sword;
// Lv3 knight helmet + team tower shield (+ runtime dark armour / arcane glow). Knight-atlas props are merged
// into a 2:1 atlas (barbarian left half, knight right half) so the unit stays one material.
if (want('walk')) {
  const doc = await io.read(CHAR('Barbarian.glb'));
  keepClips(doc, CLIPS.walk);
  dropNodes(doc, ['1H_Axe_Offhand', '2H_Axe', 'Mug']);
  const done = new Set();
  for (const mesh of doc.getRoot().listMeshes()) remapU(mesh, 0.5, 0, done);
  const round = findNode(doc, 'Barbarian_Round_Shield');
  const axe = findNode(doc, '1H_Axe');
  const hat = findNode(doc, 'Barbarian_Hat');
  const add = async (name, file, like, meshName) => {
    const mesh = await importMesh(doc, file, meshName);
    remapU(mesh, 0.5, 0.5, done);
    return attach(doc, like.getParentNode(), name, mesh, like);
  };
  await add('Kite_Shield', PROP('shield_badge_color.gltf'), round);
  await add('Tower_Shield', PROP('shield_square_color.gltf'), round);
  await add('Sword', PROP('sword_1handed.gltf'), axe);
  await add('Knight_Helmet', CHAR('Knight.glb'), hat, 'Knight_Helmet');
  const pauldron = await importMesh(doc, PROP('shield_round.gltf'));
  remapU(pauldron, 0.5, 0.5, done);
  for (const [side, sx] of [['l', 1], ['r', -1]]) {
    const rot = qmul(zRot(-sx * 1.0), xRot(-Math.PI / 2));
    place(doc, `Pauldron_${side.toUpperCase()}`, pauldron, `upperarm.${side}`, [sx * 0.45, 1.25, 0], rot, 0.72);
  }
  const png = await sharp({ create: { width: 512, height: 256, channels: 3, background: '#000000' } })
    .composite([
      { input: await atlas256('barbarian_texture.png'), left: 0, top: 0 },
      { input: await atlas256('knight_texture.png'), left: 256, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  unifyMaterial(doc, png, 'barbarian_knight_atlas');
  await finalize(doc, 'walk.glb');
}

// ------------------------------------------------------------------ marki (bull, Quaternius)
// Material colours are baked into COLOR_0 plus a `_PART` index (material slot) so the runtime can
// recolour horns/body per level/team. Lv2/Lv3 armour (KayKit shields as pauldrons + back saddle) is baked the same way
// (colours sampled from the knight atlas, red heraldry -> `plate_team`) and parented to bones.
if (want('marki')) {
  const doc = await io.read(resolve(bullPath));
  keepClips(doc, CLIPS.marki);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const parts = [];
  const partIndex = (name) => {
    let i = parts.indexOf(name);
    if (i < 0) i = parts.push(name) - 1;
    return i;
  };
  const mat = doc.createMaterial('bull').setRoughnessFactor(0.8).setMetallicFactor(0);
  const bake = (prim, colorOf, part) => {
    const n = prim.getAttribute('POSITION').getCount();
    const col = new Float32Array(n * 3);
    const idx = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      col.set(colorOf(i), i * 3);
      idx[i] = part(i);
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer));
    prim.setAttribute('_PART', doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
    prim.setAttribute('TEXCOORD_0', null);
    prim.setMaterial(mat);
  };
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const m = prim.getMaterial();
      const c = m.getBaseColorFactor().slice(0, 3);
      const k = partIndex(m.getName());
      bake(prim, () => c, () => k);
    }
  }
  // Shoulder plates from the knight atlas: sample the texture per vertex (sRGB -> linear).
  const { data, info } = await sharp(TEX('knight_texture.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const sample = (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.round(u * (info.width - 1))));
    const y = Math.min(info.height - 1, Math.max(0, Math.round(v * (info.height - 1))));
    const o = (y * info.width + x) * 3;
    return [lin(data[o]), lin(data[o + 1]), lin(data[o + 2])];
  };
  const isTeam = (c) => c[0] > 0.25 && c[0] > c[1] * 2.5 && c[0] > c[2] * 2; // red heraldry cells
  const plate = partIndex('plate');
  const plateTeam = partIndex('plate_team');
  const bakeProp = async (file) => {
    const mesh = await importMesh(doc, PROP(file));
    for (const prim of mesh.listPrimitives()) {
      const uv = prim.getAttribute('TEXCOORD_0');
      const e = [0, 0];
      const cols = [];
      for (let i = 0; i < uv.getCount(); i++) cols.push(sample(...uv.getElement(i, e)));
      bake(prim, (i) => cols[i], (i) => (isTeam(cols[i]) ? plateTeam : plate));
    }
    return mesh;
  };
  // Shoulder plates (Lv2+): round team shields on both front shoulders, facing outwards.
  const pauldron = await bakeProp('shield_round_color.gltf');
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const rot = qmul(yRot((sx * Math.PI) / 2), xRot(-0.25));
    place(doc, `Plate_${side}`, pauldron, `FrontShoulder.${side}`, [sx * 1.22, 2.6, 1.75], rot, 1.9);
  }
  // Saddle plates on the back (Lv2 round, Lv3 spiked), facing up.
  place(doc, 'Saddle', await bakeProp('shield_round_color.gltf'), 'Torso', [0, 4.36, 0.15], xRot(-Math.PI / 2), 2.7);
  place(doc, 'Saddle_Spike', await bakeProp('shield_spikes_color.gltf'), 'Torso', [0, 4.36, 0.15], xRot(-Math.PI / 2), 2.7);
  for (const m of root.listMaterials()) if (m !== mat) m.dispose();
  await doc.transform(F.join({ keepNamed: true }));
  root.listScenes()[0].setExtras({ parts });
  await finalize(doc, 'marki.glb');
}

// ------------------------------------------------------------------ insaner (imp, KayKit Rogue)
// Small mischievous devil. The Rogue body (hair head, tunic, boots) is recoloured per level at runtime
// (tunic cells -> skin at Lv1 for a bare chest); Knife + Knife_Offhand are the Lv2/Lv3 curved daggers.
// Horns, tail, grin, bone mask, loincloth, jester coat, flame cape and orbit shards are procedural.
if (want('insaner')) {
  const doc = await io.read(CHAR('Rogue.glb'));
  keepClips(doc, CLIPS.insaner);
  dropNodes(doc, ['1H_Crossbow', '2H_Crossbow', 'Throwable', 'Rogue_Cape']);
  // Bare skull: strip the hair (atlas cell 1,0) from the head; horns are generated at runtime.
  dropCellTriangles(findNode(doc, 'Rogue_Head').getMesh(), (c, r) => c === 1 && r === 0);
  unifyMaterial(doc, await atlas256('rogue_texture.png'), 'rogue_atlas');
  await finalize(doc, 'insaner.glb');
}
