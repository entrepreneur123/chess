// Renders all brand PNGs from the SVG/HTML sources in this folder.
//   node docs/brand/render.mjs
// Outputs: public/icons/*.png, public/apple-touch-icon.png, public/og.png,
//          docs/brand/out/{play-icon-512,feature-graphic-1024x500,icon-rounded-512}.png
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // resolved via NODE_PATH / global install

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(here, 'out');
const pub = resolve(root, 'public');
mkdirSync(out, { recursive: true });
mkdirSync(resolve(pub, 'icons'), { recursive: true });

const master = readFileSync(resolve(here, 'icon.svg'), 'utf8');
// Maskable: keep the full-bleed background, shrink the artwork into the 80% safe zone.
const maskable = master
  .replace('<!--content-->', '<g transform="translate(256 256) scale(0.8) translate(-256 -256)">')
  .replace('<!--/content-->', '</g>');

const browser = await chromium.launch();

async function renderSvg(svg, file, size, { rounded = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const radius = rounded ? `border-radius:${Math.round(size * 0.225)}px;overflow:hidden;` : '';
  const sized = svg.replace('<svg ', `<svg style="width:${size}px;height:${size}px;display:block" `);
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${radius}">${sized}</div></body></html>`);
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
  console.log('wrote', file);
}

await renderSvg(master, resolve(out, 'play-icon-512.png'), 512);
await renderSvg(master, resolve(out, 'icon-rounded-512.png'), 512, { rounded: true });
await renderSvg(master, resolve(pub, 'icons/icon-512.png'), 512, { rounded: true });
await renderSvg(master, resolve(pub, 'icons/icon-192.png'), 192, { rounded: true });
await renderSvg(maskable, resolve(pub, 'icons/maskable-512.png'), 512);
await renderSvg(maskable, resolve(pub, 'icons/maskable-192.png'), 192);
await renderSvg(master, resolve(pub, 'apple-touch-icon.png'), 180);
await renderSvg(master, resolve(out, 'icon-48-preview.png'), 48, { rounded: true });

async function renderHtml(query, file, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(pathToFileURL(resolve(here, 'feature-graphic.html')).href + query);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: file });
  await page.close();
  console.log('wrote', file);
}
await renderHtml('', resolve(out, 'feature-graphic-1024x500.png'), 1024, 500);
await renderHtml('?og', resolve(pub, 'og.png'), 1200, 630);

await browser.close();
