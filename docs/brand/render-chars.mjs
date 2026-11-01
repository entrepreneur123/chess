// Renders the 3D character illustrations to transparent PNGs.
//   node docs/brand/render-chars.mjs [--sheet /tmp/sheet.png] [--only sad,marki,walk]
// Outputs (public/chars):
//   {character}-lv{1..3}-{0|1}.png        512x512 hero shots (3/4 view, 3-point lighting)
//   portrait-{character}-lv{1..3}.png     256x256 head-and-shoulders crops (blue team)
// The models come straight from src/render/characters (procedural three.js). A temporary Vite dev
// server + headless Chromium (WebGL, preserveDrawingBuffer) render them; nothing is left behind.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = resolve(root, 'public/chars');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sheetPath = argVal('--sheet');
const only = (argVal('--only') ?? 'sad,marki,walk').split(',');

const CHARS = ['sad', 'marki', 'walk'].filter((c) => only.includes(c));
const LEVELS = [1, 2, 3];
const OWNERS = [0, 1];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
#out{display:block}
#gl{position:absolute;left:-4000px;top:0}
</style></head><body><canvas id="out"></canvas><canvas id="gl"></canvas>
<script type="module" src="/main.js"></script></body></html>`;

const mainJs = `
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCharacterModel } from '@chars';

const SS = 1024; // supersampled render size
const glCanvas = document.getElementById('gl');
const outCanvas = document.getElementById('out');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SS, SS, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// 3-point lighting: warm key (front-left, high), cool fill (right), rim from behind.
const key = new THREE.DirectionalLight(0xfff0dc, 2.8);
key.position.set(-2.6, 4.2, 3.4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -1.2; key.shadow.camera.right = 1.2; key.shadow.camera.top = 1.6; key.shadow.camera.bottom = -0.6;
key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
scene.add(key);
const fill = new THREE.DirectionalLight(0xa9c6ff, 1.0);
fill.position.set(3.2, 1.6, 2.4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 2.2);
rim.position.set(1.2, 3.0, -4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xd3dcff, 0x3b2f2a, 0.7));

// soft contact shadow blob
const sc = document.createElement('canvas'); sc.width = sc.height = 128;
const sx = sc.getContext('2d');
const grad = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.18)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
sx.fillStyle = grad; sx.fillRect(0, 0, 128, 128);
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.002;
scene.add(blob);

const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);

const YAW = { hero: 0.62, portrait: 0.32 };
let current = null;

function projectFit(box, tgt0, elev, iters = 8) {
  // iteratively centre + scale so the box fills 92% of the frame
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const tgt = tgt0.clone();
  let dist = 4;
  const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
  for (let i = 0; i < iters; i++) {
    camera.position.copy(tgt).addScaledVector(dir, dist);
    camera.lookAt(tgt);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let minx = 9, maxx = -9, miny = 9, maxy = -9;
    for (const c of corners) {
      const p = c.clone().project(camera);
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const half = Math.max(maxx - minx, maxy - miny) / 2;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    tgt.addScaledVector(right, cx * halfH).addScaledVector(up, cy * halfH);
    dist *= half / 0.95;
  }
  camera.position.copy(tgt).addScaledVector(dir, dist);
  camera.lookAt(tgt);
  camera.updateMatrixWorld(true);
}

function unionBox(character, owner, yaw) {
  const box = new THREE.Box3();
  for (const level of [1, 2, 3]) {
    const m = buildCharacterModel({ character, level, owner });
    m.rotation.y = yaw;
    m.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(m));
  }
  return box;
}

// Portrait framing per character: [target (x,y,z) in model space, vertical half-extent]
const PORTRAIT = {
  sad: { t: [0, 0.69, 0.04], half: 0.27 },
  marki: { t: [0.02, 0.42, 0.38], half: 0.34 },
  walk: { t: [0, 0.69, 0.05], half: 0.27 },
};

window.draw = ({ character, level, owner, size, mode }) => {
  if (current) { scene.remove(current); current = null; }
  const m = buildCharacterModel({ character, level, owner });
  m.rotation.y = mode === 'portrait' ? YAW.portrait : YAW.hero;
  m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(m);
  current = m;
  blob.visible = mode !== 'portrait';
  m.updateMatrixWorld(true);
  if (mode === 'hero') {
    const box = unionBox(character, owner, YAW.hero);
    projectFit(box, box.getCenter(new THREE.Vector3()), THREE.MathUtils.degToRad(17));
  } else {
    const p = PORTRAIT[character];
    const t = new THREE.Vector3(...p.t).applyAxisAngle(new THREE.Vector3(0, 1, 0), YAW.portrait);
    const box = new THREE.Box3(new THREE.Vector3(t.x - p.half, t.y - p.half, t.z - p.half), new THREE.Vector3(t.x + p.half, t.y + p.half, t.z + p.half));
    projectFit(box, t, THREE.MathUtils.degToRad(9));
  }
  renderer.render(scene, camera);
  outCanvas.width = size; outCanvas.height = size;
  outCanvas.style.width = size + 'px'; outCanvas.style.height = size + 'px';
  const ctx = outCanvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(glCanvas, 0, 0, SS, SS, 0, 0, size, size);
  let tris = 0;
  m.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { tris };
};
window.__ready = true;
`;

const tmp = mkdtempSync(join(tmpdir(), 'char-harness-'));
writeFileSync(join(tmp, 'index.html'), html);
writeFileSync(join(tmp, 'main.js'), mainJs);

const threeDir = resolve(root, 'node_modules/three');
const server = await createServer({
  root: tmp,
  configFile: false,
  logLevel: 'error',
  cacheDir: join(tmp, '.vite'),
  server: { host: '127.0.0.1', port: 0, fs: { strict: false } },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: [
      { find: /^three$/, replacement: join(threeDir, 'build/three.module.js') },
      { find: /^three\/examples\/(.*)$/, replacement: join(threeDir, 'examples/$1') },
      { find: /^@chars$/, replacement: resolve(root, 'src/render/characters/index.ts') },
    ],
  },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.config.server.port}/`;

const browser = await chromium.launch();
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => (m.type() === 'error' ? console.error('console:', m.text()) : undefined));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

  const shoot = async (params, file) => {
    const stats = await page.evaluate((p) => window.draw(p), params);
    await page.locator('#out').screenshot({ path: join(outDir, file), omitBackground: true });
    return stats;
  };

  for (const character of CHARS) {
    for (const level of LEVELS) {
      let tris = 0;
      for (const owner of OWNERS) {
        const s = await shoot({ character, level, owner, size: 512, mode: 'hero' }, `${character}-lv${level}-${owner}.png`);
        tris = s.tris;
      }
      await shoot({ character, level, owner: 0, size: 256, mode: 'portrait' }, `portrait-${character}-lv${level}.png`);
      results.push({ character, level, tris });
      console.log(`${character} lv${level}: ${tris} tris`);
    }
  }

  if (sheetPath) {
    // QA contact sheet (not part of the deliverables): rows = character x team, columns = levels.
    const files = [];
    for (const c of CHARS) for (const o of OWNERS) for (const l of LEVELS) files.push(join(outDir, `${c}-lv${l}-${o}.png`));
    const pf = [];
    for (const c of CHARS) for (const l of LEVELS) pf.push(join(outDir, `portrait-${c}-lv${l}.png`));
    const uri = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    const imgs = files.map((f) => `<img src="${uri(f)}" width="340" height="340">`).join('');
    const pimgs = pf.map((f) => `<img src="${uri(f)}" width="256" height="256">`).join('');
    const sheet = await browser.newPage({ viewport: { width: 1020, height: 340 * CHARS.length * OWNERS.length + 256 * CHARS.length } });
    await sheet.setContent(
      `<body style="margin:0;background:#1B2546;display:flex;flex-wrap:wrap;width:1020px">${imgs}<div style="width:100%;height:0"></div>${pimgs}</body>`,
    );
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
