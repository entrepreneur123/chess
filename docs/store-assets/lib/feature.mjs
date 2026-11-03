// Google Play feature graphic (1024x500) from docs/brand/feature-graphic.html, served by the Vite
// dev server so the app's bundled fonts load exactly as in the app.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './director.mjs';

export const FEATURE_OUT = resolve(ROOT, 'docs/brand/out/feature-graphic-1024x500.png');

export async function renderFeatureGraphic(browser, base) {
  mkdirSync(resolve(ROOT, 'docs/brand/out'), { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.goto(base + '/docs/brand/feature-graphic.html');
  await page.evaluate(() => window.ready);
  await page.screenshot({ path: FEATURE_OUT });
  await page.close();
  console.log('wrote', FEATURE_OUT);
}
