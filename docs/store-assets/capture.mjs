// Captures Google Play store screenshots from the built app and composes framed promo images.
//   npm run build && node docs/store-assets/capture.mjs
// Output: docs/store-assets/out/raw-*.png (1080x1920) and docs/store-assets/out/promo-*.png (1080x1920 framed, captioned).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(here, 'out');
mkdirSync(out, { recursive: true });

const PORT = 5191;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
const BASE = `http://localhost:${PORT}`;
await new Promise((r) => setTimeout(r, 2500));

const SHOTS = [
  { key: 'lobby', title: '말 3개, 144칸, 60초', sub: '12×12 전술 아레나에서 1:1 대전' },
  { key: 'game', title: '탭 한 번으로 이동', sub: '경로 위 첫 번째 적을 잡아라' },
  { key: 'formation', title: '진형이 곧 전략', sub: '내 구역 3×12에 자유롭게 배치' },
  { key: 'collection', title: '보석으로 Lv.3까지 강화', sub: '강화 전후 이동 범위를 한눈에' },
  { key: 'shop', title: '상자를 열고 카드를 모으세요', sub: '하루 1회 무료 상자' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });
const raw = {};
const shot = async (key) => {
  const file = resolve(out, `raw-${key}.png`);
  await page.screenshot({ path: file });
  raw[key] = file;
  console.log('captured', file);
};

await page.goto(BASE + '/');
await page.waitForTimeout(1500);
const skip = await page.$('[data-action="tut-skip"]');
if (skip) {
  await skip.click();
  await page.waitForTimeout(500);
}
await shot('lobby');
await page.click('[data-nav="formation"]');
await page.waitForTimeout(700);
await shot('formation');
await page.goBack();
await page.waitForTimeout(500);
await page.click('[data-nav="collection"]');
await page.waitForTimeout(700);
await shot('collection');
await page.goBack();
await page.waitForTimeout(500);
await page.click('[data-nav="shop"]');
await page.waitForTimeout(700);
await shot('shop');
await page.goBack();
await page.waitForTimeout(500);
await page.click('[data-action="start-match"]');
await page.waitForTimeout(4800);
// Select the first own piece found by scanning the lower board so the shot shows move highlights.
const bb = await (await page.$('canvas')).boundingBox();
outer: for (let fy = 0.84; fy >= 0.5; fy -= 0.025) {
  for (let fx = 0.08; fx <= 0.92; fx += 0.04) {
    await page.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy);
    await page.waitForTimeout(60);
    const t = await page.$eval('.coach', (e) => (e.hidden ? '' : e.textContent)).catch(() => '');
    if (t.includes('빛나는')) break outer;
  }
}
await page.waitForTimeout(400);
await shot('game');

// Compose framed promo images.
const promo = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
for (const s of SHOTS) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:1080px;height:1920px;overflow:hidden;font-family:Roboto,'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#fff;
      background:radial-gradient(80% 50% at 50% 0%,rgba(61,139,255,.35),transparent 60%),radial-gradient(70% 40% at 50% 110%,rgba(255,77,79,.25),transparent 60%),linear-gradient(180deg,#0b1020,#121b33 50%,#0b1020)}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.04) 2px,transparent 2px);background-size:72px 72px}
    .copy{position:relative;padding:120px 80px 0;text-align:center}
    h1{margin:0;font-size:72px;font-weight:900;letter-spacing:-1px;line-height:1.15}
    h1 em{font-style:normal;color:#ffc247}
    p{margin:18px 0 0;font-size:36px;color:#aab6d6;font-weight:600}
    .phone{position:absolute;left:50%;top:430px;width:780px;height:1560px;transform:translateX(-50%);border-radius:72px;background:#05070f;padding:22px;box-shadow:0 60px 120px rgba(0,0,0,.7),inset 0 0 0 3px rgba(255,255,255,.12)}
    .phone img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:52px;display:block}
  </style></head><body><div class="grid"></div>
  <div class="copy"><h1>${s.title.replace(/(\d+)/g, '<em>$1</em>')}</h1><p>${s.sub}</p></div>
  <div class="phone"><img src="file://${raw[s.key]}" /></div></body></html>`;
  await promo.setContent(html);
  await promo.waitForTimeout(300);
  const file = resolve(out, `promo-${s.key}.png`);
  await promo.screenshot({ path: file });
  console.log('composed', file);
}
await browser.close();
server.kill();
