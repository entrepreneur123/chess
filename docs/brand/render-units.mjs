// Renders the in-game glTF units (src/render/units: same templates, gear, palettes and FX as the
// board) to transparent hero PNGs for the collection UI.
//   node docs/brand/render-units.mjs [--only sad,marki,walk,insaner] [--out public/chars] [--sheet /tmp/sheet.png]
//                                    [--qa <dir>] [--size 512]
// Outputs: <out>/unit-{sad|marki|walk|insaner}-lv{1..3}-{0|1}.png  (512x512 RGBA, 3/4 hero angle, 3-point light)
// --qa <dir> also writes close-ups (front / back / side) per character and level for review.
// Needs playwright + a Chromium with WebGL (headless SwiftShader works). A temporary Vite dev
// server serves the real modules and public/models; nothing is left behind.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = createRequire(join(process.env.NODE_PATH ?? '/opt/node22/lib/node_modules', 'noop.js'))('playwright'));
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = resolve(root, argVal('--out') ?? 'public/chars');
const sheetPath = argVal('--sheet');
const qaDir = argVal('--qa');
const size = Number(argVal('--size') ?? 512);
const only = (argVal('--only') ?? 'sad,marki,walk,insaner').split(',');
const CHARS = ['sad', 'marki', 'walk', 'insaner'].filter((c) => only.includes(c));
const LEVELS = [1, 2, 3];
const OWNERS = [0, 1];
mkdirSync(outDir, { recursive: true });
if (qaDir) mkdirSync(qaDir, { recursive: true });

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}#gl{position:absolute;left:-5000px;top:0}
</style></head><body><canvas id="gl"></canvas><script type="module" src="/main.ts"></script></body></html>`;

const mainTs = `
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadUnitAssets } from '@units/assets';
import { UnitLibrary } from '@units/library';

const SS = 1024;
const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SS, SS, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
// 3-point lighting: warm key (front-left, high), cool fill (right), strong rim from behind.
const key = new THREE.DirectionalLight(0xfff0dc, 2.7);
key.position.set(-2.6, 4.2, 3.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -1, near: 0.5, far: 14 });
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.02;
scene.add(key);
const fill = new THREE.DirectionalLight(0xa9c6ff, 1.0);
fill.position.set(3.2, 1.6, 2.4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 2.4);
rim.position.set(1.2, 3.0, -4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xd3dcff, 0x3b2f2a, 0.8));

// Soft contact shadow.
const sc = document.createElement('canvas'); sc.width = sc.height = 128;
const sx = sc.getContext('2d')!;
const grad = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.2)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
sx.fillStyle = grad; sx.fillRect(0, 0, 128, 128);
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.002;
scene.add(blob);

const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 60);
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
let lib: UnitLibrary;

function fit(box: THREE.Box3, elev: number, yaw: number, margin: number) {
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const tgt = box.getCenter(new THREE.Vector3());
  let dist = 6;
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
  for (let i = 0; i < 10; i++) {
    camera.position.copy(tgt).addScaledVector(dir, dist);
    camera.lookAt(tgt);
    camera.updateMatrixWorld(true);
    let minx = 9, maxx = -9, miny = 9, maxy = -9;
    for (const c of corners) {
      const p = c.clone().project(camera);
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    tgt.addScaledVector(right, ((minx + maxx) / 2) * halfH).addScaledVector(up, ((miny + maxy) / 2) * halfH);
    dist *= Math.max(maxx - minx, maxy - miny) / 2 / margin;
  }
  camera.position.copy(tgt).addScaledVector(dir, dist);
  camera.lookAt(tgt);
  camera.updateMatrixWorld(true);
}

function poseBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o: any) => {
    if (!o.isSkinnedMesh) return;
    o.computeBoundingBox();
    box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

const boxCache = new Map<string, THREE.Box3>();
function unionBox(ch: string): THREE.Box3 {
  let b = boxCache.get(ch);
  if (b) return b;
  b = new THREE.Box3();
  for (const level of [1, 2, 3]) {
    const a = lib.createActor({ id: 'x', owner: 0, character: ch as any, level: level as any, pos: { r: 0, c: 0 } });
    a.update(1.3);
    b.union(poseBox(a.object));
    a.dispose();
  }
  boxCache.set(ch, b);
  return b;
}

(window as any).init = async () => {
  const assets = await loadUnitAssets();
  lib = new UnitLibrary(assets, { value: SS / (2 * Math.tan(THREE.MathUtils.degToRad(12))) });
  return true;
};

(window as any).draw = ({ character, level, owner, size, yaw, elev, frame, tight }: any) => {
  const actor = lib.createActor({ id: 'x', owner, character, level, pos: { r: 0, c: 0 } });
  scene.add(actor.object);
  actor.object.rotation.y = 0;
  actor.update(frame ?? 1.3);
  lib.update(frame ?? 1.3);
  actor.object.traverse((o: any) => { if (o.isSkinnedMesh) o.castShadow = true; });
  const box = tight ? poseBox(actor.object) : unionBox(character).clone();
  if (!tight) box.max.y += 0.12; // headroom for plumes / FX
  fit(box, THREE.MathUtils.degToRad(elev ?? 14), yaw ?? 0.62, tight ? 0.86 : 0.94);
  lib.uniforms.pointScale.value = SS / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  const fx: THREE.Object3D[] = [];
  const meshes: THREE.SkinnedMesh[] = [];
  actor.object.traverse((o: any) => { if (o.userData.unitFx) fx.push(o); if (o.isSkinnedMesh) meshes.push(o); });
  // Pass A: body + shadow (FX hidden), transparent background.
  fx.forEach((o) => (o.visible = false));
  blob.visible = true;
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(glCanvas, 0, 0, SS, SS, 0, 0, size, size);
  // Pass B: additive FX on black (body as a depth-only occluder) -> premultiplied glow layer.
  if (fx.length) {
    fx.forEach((o) => (o.visible = true));
    blob.visible = false;
    const mats = meshes.map((m) => m.material);
    meshes.forEach((m) => (m.material = depthOnly));
    renderer.setClearColor(0x000000, 1);
    renderer.render(scene, camera);
    meshes.forEach((m, i) => (m.material = mats[i] as THREE.Material));
    const fxc = document.createElement('canvas');
    fxc.width = fxc.height = size;
    const fctx = fxc.getContext('2d')!;
    fctx.imageSmoothingEnabled = true; fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(glCanvas, 0, 0, SS, SS, 0, 0, size, size);
    const id = fctx.getImageData(0, 0, size, size);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = Math.max(d[i], d[i + 1], d[i + 2]);
      if (a === 0) { d[i + 3] = 0; continue; }
      d[i] = Math.min(255, (d[i] * 255) / a); d[i + 1] = Math.min(255, (d[i + 1] * 255) / a); d[i + 2] = Math.min(255, (d[i + 2] * 255) / a); d[i + 3] = a;
    }
    fctx.putImageData(id, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(fxc, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  const tris = lib.triangles({ character, level, owner });
  scene.remove(actor.object);
  actor.dispose();
  return { url: out.toDataURL('image/png'), tris };
};
(window as any).__ready = true;
`;

const tmp = mkdtempSync(join(tmpdir(), 'unit-render-'));
writeFileSync(join(tmp, 'index.html'), html);
writeFileSync(join(tmp, 'main.ts'), mainTs);
const threeDir = resolve(root, 'node_modules/three');
const server = await createServer({
  root: tmp,
  configFile: false,
  logLevel: 'error',
  publicDir: resolve(root, 'public'),
  cacheDir: join(tmp, '.vite'),
  server: { host: '127.0.0.1', port: 0, fs: { strict: false } },
  resolve: {
    alias: [
      { find: /^three$/, replacement: join(threeDir, 'build/three.module.js') },
      { find: /^three\/examples\/(.*)$/, replacement: join(threeDir, 'examples/$1') },
      { find: /^three\/addons\/(.*)$/, replacement: join(threeDir, 'examples/jsm/$1') },
      { find: /^@units\/(.*)$/, replacement: resolve(root, 'src/render/units') + '/$1' },
    ],
  },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.config.server.port}/`;

const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
let browser;
try {
  browser = await chromium.launch(launch);
} catch {
  browser = await chromium.launch({ ...launch, executablePath: '/usr/bin/google-chrome' });
}
const save = (file, dataUrl) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => (m.type() === 'error' ? console.error('console:', m.text()) : undefined));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.evaluate(() => window.init());

  const files = [];
  for (const character of CHARS) {
    for (const level of LEVELS) {
      for (const owner of OWNERS) {
        const r = await page.evaluate((p) => window.draw(p), { character, level, owner, size, yaw: 0.62, elev: 14, tight: true });
        const f = join(outDir, `unit-${character}-lv${level}-${owner}.png`);
        save(f, r.url);
        files.push(f);
        if (owner === 0) console.log(`${character} lv${level}: ${r.tris} tris`);
      }
      if (qaDir) {
        for (const [name, yaw, elev] of [['front', 0.0, 10], ['back', Math.PI + 0.5, 18], ['side', 1.45, 8]]) {
          const r = await page.evaluate((p) => window.draw(p), { character, level, owner: 0, size: 768, yaw, elev, tight: true });
          save(join(qaDir, `close-${character}-lv${level}-${name}.png`), r.url);
        }
        const r = await page.evaluate((p) => window.draw(p), { character, level, owner: 1, size: 768, yaw: -0.7, elev: 12, tight: true });
        save(join(qaDir, `close-${character}-lv${level}-red.png`), r.url);
      }
    }
  }

  if (sheetPath) {
    // QA contact sheet (not a deliverable): rows = character x team, columns = levels.
    const ordered = [];
    for (const c of CHARS) for (const o of OWNERS) for (const l of LEVELS) ordered.push(join(outDir, `unit-${c}-lv${l}-${o}.png`));
    const uri = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    const imgs = ordered.map((f) => `<img src="${uri(f)}" width="340" height="340">`).join('');
    const sheet = await browser.newPage({ viewport: { width: 1020, height: 340 * CHARS.length * OWNERS.length } });
    await sheet.setContent(`<body style="margin:0;background:#1B2546;display:flex;flex-wrap:wrap;width:1020px">${imgs}</body>`);
    await sheet.waitForTimeout(300);
    await sheet.screenshot({ path: sheetPath, fullPage: true });
    console.log('sheet ->', sheetPath);
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log('done ->', outDir);
